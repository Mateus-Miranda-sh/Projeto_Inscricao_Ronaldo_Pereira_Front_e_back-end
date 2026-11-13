import os
import re
import io
import base64
import unicodedata
import logging
import mercadopago
import json
import urllib.request
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    import qrcode
except ImportError:
    qrcode = None

# Configuração de logging estruturado
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)

# Carrega variáveis do arquivo .env
load_dotenv()

app = Flask(__name__)

# ------------------------------------------------------------------------------
# 1. HARDENING DE SEGURANÇA: Configurações Globais
# ------------------------------------------------------------------------------

app.config['MAX_CONTENT_LENGTH'] = 16 * 1024  # 16 KB
VALORES_PERMITIDOS = {50.0, 80.0}

CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

MERCADO_PAGO_ACCESS_TOKEN = os.getenv('MERCADO_PAGO_ACCESS_TOKEN')

if not MERCADO_PAGO_ACCESS_TOKEN:
    logging.critical("FALHA DE INICIALIZAÇÃO: MERCADO_PAGO_ACCESS_TOKEN não definido no .env!")
    raise ValueError("Token do Mercado Pago não encontrado no arquivo .env")

sdk = mercadopago.SDK(MERCADO_PAGO_ACCESS_TOKEN)


# ------------------------------------------------------------------------------
# 2. CABEÇALHOS DE SEGURANÇA (Security Headers)
# ------------------------------------------------------------------------------
@app.after_request
def aplicar_cabecalhos_seguranca(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


def remover_acentos(texto: str) -> str:
    """Remove acentos e caracteres especiais exigidos pelo padrão EMV do Banco Central."""
    nfkd = unicodedata.normalize('NFKD', texto)
    return "".join([c for c in nfkd if not unicodedata.combining(c)])


def gerar_brcode_pix_padrao(valor: float, nome: str, cidade: str, chave: str) -> str:
    """Gera o código Pix Copia e Cola (BR Code) no padrão oficial do Banco Central com CRC16 válido."""
    valor_str = f"{valor:.2f}"
    nome_sanitizado = remover_acentos(nome)[:25].upper()
    cidade_sanitizada = remover_acentos(cidade)[:15].upper()
    chave_limpa = chave.strip()

    # Campo 26: Merchant Account Information (calcula o tamanho dinâmico para qualquer tipo de chave)
    gui = "0014br.gov.bcb.pix"
    campo_chave = f"01{len(chave_limpa):02d}{chave_limpa}"
    merchant_account = f"{gui}{campo_chave}"
    campo_26 = f"26{len(merchant_account):02d}{merchant_account}"

    payload = (
        f"000201"
        f"{campo_26}"
        f"52040000"
        f"5303986"
        f"54{len(valor_str):02d}{valor_str}"
        f"5802BR"
        f"59{len(nome_sanitizado):02d}{nome_sanitizado}"
        f"60{len(cidade_sanitizada):02d}{cidade_sanitizada}"
        f"62070503***"
        f"6304"
    )

    crc = 0xFFFF
    for char in payload.encode('utf-8'):
        crc ^= (char << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return f"{payload}{crc:04X}"


def salvar_na_planilha_google(nome: str, email: str, telefone: str, valor: float, metodo: str):
    """Envia os dados do inscrito para o Google Sheets via Apps Script Webhook."""
    webhook_url = os.getenv('GOOGLE_SHEETS_WEBHOOK', '').strip()
    if not webhook_url:
        return
    try:
        payload = json.dumps({
            'nome': nome,
            'email': email,
            'telefone': telefone or 'Não informado',
            'valor': f"R$ {valor:.2f}".replace('.', ','),
            'metodo': metodo
        }).encode('utf-8')

        req = urllib.request.Request(
            webhook_url,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            logging.info(f"📊 Inscrição de '{nome}' salva no Google Sheets (HTTP {resp.status})")
    except Exception as e:
        logging.error(f"⚠️ Falha ao salvar na planilha Google (não bloqueia pagamento): {e}")


def gerar_qr_code_pix_base64(codigo_pix: str) -> str:
    """Renderiza a imagem PNG do QR Code Pix em Base64 para exibição imediata no frontend."""
    if qrcode is not None:
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=8,
            border=2
        )
        qr.add_data(codigo_pix)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return base64.b64encode(buf.getvalue()).decode('utf-8')
    return ""


# ------------------------------------------------------------------------------
# 3. HIGIENIZAÇÃO E VALIDAÇÃO ESTRITA DE ENTRADA (Defesa em Profundidade)
# ------------------------------------------------------------------------------
REGEX_EMAIL = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
REGEX_NOME = re.compile(r"^[a-zA-ZÀ-ÿ\s'.-]{3,100}$")


def validar_e_sanitizar_dados(dados):
    if not isinstance(dados, dict):
        return None, "Corpo da requisição deve ser um JSON válido."

    valor_bruto = dados.get('valor')
    if valor_bruto is None or valor_bruto == '':
        return None, "O valor da inscrição é obrigatório."

    try:
        limpo = str(valor_bruto).replace('R$', '').replace(' ', '').replace(',', '.')
        valor = float(limpo)
    except (ValueError, TypeError):
        return None, "Formato de valor numérico inválido."

    if valor not in VALORES_PERMITIDOS:
        logging.warning(f"🚨 ALERTA RED TEAM: Tentativa de manipulação de valor detectada! Valor recebido: {valor}")
        return None, f"Valor não autorizado. Os valores permitidos são: {', '.join(str(v) for v in sorted(VALORES_PERMITIDOS))}."

    nome = str(dados.get('nome') or '').strip()
    if not nome or not REGEX_NOME.match(nome):
        return None, "Nome inválido. Deve conter apenas letras e ter entre 3 e 100 caracteres."

    email = str(dados.get('email') or '').strip().lower()
    if not email or len(email) > 100 or not REGEX_EMAIL.match(email):
        return None, "E-mail inválido ou mal formatado."

    telefone_bruto = str(dados.get('telefone') or '')
    telefone = re.sub(r'\D', '', telefone_bruto)
    if telefone and (len(telefone) < 10 or len(telefone) > 11):
        return None, "Telefone inválido. Deve conter DDD + número (10 ou 11 dígitos)."

    partes_nome = nome.split()
    primeiro_nome = partes_nome[0]
    sobrenome = ' '.join(partes_nome[1:]) if len(partes_nome) > 1 else 'Participante'

    return {
        'nome': nome,
        'primeiro_nome': primeiro_nome,
        'sobrenome': sobrenome,
        'email': email,
        'telefone': telefone,
        'valor': valor
    }, None


# ------------------------------------------------------------------------------
# 4. ENDPOINTS DA API
# ------------------------------------------------------------------------------

@app.route('/')
def healthcheck():
    return jsonify({
        'status': 'online',
        'servico': 'API de Inscrições - Retiro Ronaldo Pereira'
    }), 200


@app.route('/api/criar-preferencia', methods=['POST'])
@app.route('/api/criar-checkout-pro', methods=['POST'])
def criar_checkout_pro():
    """Cria a preferência segura no Checkout Pro do Mercado Pago."""
    try:
        corpo = request.get_json(silent=True) or {}
        dados_validados, erro = validar_e_sanitizar_dados(corpo)

        if erro:
            return jsonify({'sucesso': False, 'erro': erro}), 400

        nome = dados_validados['nome']
        valor = dados_validados['valor']
        email = dados_validados['email']
        primeiro_nome = dados_validados['primeiro_nome']
        sobrenome = dados_validados['sobrenome']

        origem = request.referrer or request.host_url or 'http://127.0.0.1:5500/pagamento.html'

        preference_data = {
            'items': [
                {
                    'title': f'Inscrição Retiro - {nome}',
                    'quantity': 1,
                    'unit_price': valor,
                    'currency_id': 'BRL',
                }
            ],
            'payer': {
                'name': primeiro_nome,
                'surname': sobrenome,
                'email': email,
            },
        }

        if origem and origem.startswith(('http://', 'https://')):
            preference_data['back_urls'] = {
                'success': origem,
                'failure': origem,
                'pending': origem,
            }

        logging.info(f"Gerando Checkout Pro para '{nome}' com valor R$ {valor:.2f}")
        preference_response = sdk.preference().create(preference_data)
        preference = preference_response.get('response', {})

        init_point = preference.get('init_point')
        sandbox_init_point = preference.get('sandbox_init_point')
        link_checkout = init_point or sandbox_init_point

        if not link_checkout:
            msg_erro = preference.get('message') or 'Falha ao gerar link do Mercado Pago.'
            logging.error(f"Erro Mercado Pago: {msg_erro}")
            return jsonify({'sucesso': False, 'erro': 'Não foi possível gerar a sessão de pagamento.'}), 400

        salvar_na_planilha_google(nome, email, dados_validados['telefone'], valor, 'Cartão / Checkout Pro')

        return jsonify({
            'sucesso': True,
            'init_point': link_checkout,
            'sandbox_init_point': sandbox_init_point,
            'preference_id': preference.get('id')
        }), 200

    except Exception as e:
        logging.error(f"Exceção interna ao gerar Checkout Pro: {str(e)}", exc_info=True)
        return jsonify({
            'sucesso': False,
            'erro': 'Erro interno ao processar solicitação de pagamento.'
        }), 500


@app.route('/api/criar-pagamento-pix', methods=['POST'])
def criar_pagamento_pix():
    """Gera QR Code PIX oficial (BR Code) diretamente no servidor usando a chave configurada."""
    try:
        corpo = request.get_json(silent=True) or {}
        dados_validados, erro = validar_e_sanitizar_dados(corpo)

        if erro:
            logging.warning(f"⚠️ Validação rejeitou requisição PIX: {erro}")
            return jsonify({'sucesso': False, 'erro': erro}), 400

        nome_inscrito = dados_validados['nome']
        valor = float(dados_validados['valor'])

        # Lê as variáveis configuradas no painel Environment do Render
        chave_pix = os.getenv('CHAVE_PIX', '').strip()
        nome_recebedor = os.getenv('NOME_RECEBEDOR', 'Retiro Ronaldo Pereira').strip()
        cidade_recebedor = os.getenv('CIDADE_RECEBEDOR', 'JUAZEIRO').strip()

        if not chave_pix:
            logging.error("❌ CHAVE_PIX não está configurada nas variáveis de ambiente!")
            return jsonify({
                'sucesso': False,
                'erro': 'Chave PIX do recebedor não configurada no servidor.'
            }), 500

        # 1. Gera o payload oficial Copia e Cola (000201...)
        qr_code_copia_cola = gerar_brcode_pix_padrao(
            valor=valor,
            nome=nome_recebedor,
            cidade=cidade_recebedor,
            chave=chave_pix
        )

        # 2. Desenha a imagem PNG do QR Code em Base64
        qr_code_base64 = gerar_qr_code_pix_base64(qr_code_copia_cola)

        if not qr_code_base64:
            logging.error("❌ Biblioteca qrcode falhou ao gerar a imagem Base64.")
            return jsonify({
                'sucesso': False,
                'erro': 'Falha interna ao desenhar a imagem do QR Code.'
            }), 500

        salvar_na_planilha_google(nome_inscrito, dados_validados['email'], dados_validados['telefone'], valor, 'PIX Direto')

        logging.info(f"✅ QR Code Pix gerado localmente com sucesso para '{nome_inscrito}' (R$ {valor:.2f})!")
        return jsonify({
            'sucesso': True,
            'qr_code_imagem': f'data:image/png;base64,{qr_code_base64}',
            'qr_code_copia_cola': qr_code_copia_cola,
        }), 200

    except Exception as e:
        logging.error(f"❌ Exceção interna não tratada ao gerar Pix: {str(e)}", exc_info=True)
        return jsonify({
            'sucesso': False,
            'erro': 'Erro interno ao processar Pix no servidor.'
        }), 500


# ------------------------------------------------------------------------------
# 5. INICIALIZAÇÃO
# ------------------------------------------------------------------------------
if __name__ == '__main__':
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')
    porta = int(os.getenv('PORT', 5000))
    logging.info(f"Iniciando servidor na porta {porta} (Debug={debug_mode})...")
    app.run(debug=debug_mode, port=porta)
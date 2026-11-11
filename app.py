import os
import re
import logging
import mercadopago
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

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

# Limite de tamanho de payload para prevenir DoS (Buffer / Memory exhaustion)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024  # 16 KB

# Whitelist estrita de valores de inscrição (prevenção contra manipulação de preço / BOLA)
VALORES_PERMITIDOS = {50.0, 80.0}

# Configuração restrita de CORS (não expor como wildcard '*' em produção)
ALLOWED_ORIGINS = [
    origem.strip() for origem in os.getenv(
        'ALLOWED_ORIGINS',
        'http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:5000,http://localhost:5000'
    ).split(',') if origem.strip()
]

CORS(app, resources={
    r"/api/*": {
        "origins": ALLOWED_ORIGINS,
        "methods": ["POST", "GET", "OPTIONS"],
        "allow_headers": ["Content-Type"]
    }
})

# Leitura segura do Token do Mercado Pago
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
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response


# ------------------------------------------------------------------------------
# 3. HIGIENIZAÇÃO E VALIDAÇÃO ESTRITA DE ENTRADA (Defesa em Profundidade)
# ------------------------------------------------------------------------------
REGEX_EMAIL = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
REGEX_NOME = re.compile(r"^[a-zA-ZÀ-ÿ\s'.-]{3,100}$")

def validar_e_sanitizar_dados(dados):
    """
    Executa sanitização e validação estrita contra Parameter Tampering,
    Injections e valores anômalos. Retorna (dados_limpos, erro_str).
    """
    if not isinstance(dados, dict):
        return None, "Corpo da requisição deve ser um JSON válido."

    # 1. Validação de Preço (Anti-Tampering)
    valor_bruto = dados.get('valor')
    if valor_bruto is None or valor_bruto == '':
        return None, "O valor da inscrição é obrigatório."
    
    try:
        limpo = str(valor_bruto).replace('R$', '').replace(' ', '').replace(',', '.')
        valor = float(limpo)
    except (ValueError, TypeError):
        return None, "Formato de valor numérico inválido."

    # Bloqueia qualquer tentativa de alterar o valor para 0.01 ou qualquer número arbitrário
    if valor not in VALORES_PERMITIDOS:
        logging.warning(f"🚨 ALERTA RED TEAM: Tentativa de manipulação de valor detectada! Valor recebido: {valor}")
        return None, f"Valor não autorizado. Os valores permitidos são: {', '.join(str(v) for v in sorted(VALORES_PERMITIDOS))}."

    # 2. Validação e Sanitização de Nome
    nome = str(dados.get('nome') or '').strip()
    if not nome or not REGEX_NOME.match(nome):
        return None, "Nome inválido. Deve conter apenas letras e ter entre 3 e 100 caracteres."

    # 3. Validação e Sanitização de E-mail
    email = str(dados.get('email') or '').strip().lower()
    if not email or len(email) > 100 or not REGEX_EMAIL.match(email):
        return None, "E-mail inválido ou mal formatado."

    # 4. Validação e Sanitização de Telefone
    telefone_bruto = str(dados.get('telefone') or '')
    telefone = re.sub(r'\D', '', telefone_bruto)
    if telefone and (len(telefone) < 10 or len(telefone) > 11):
        return None, "Telefone inválido. Deve conter DDD + número (10 ou 11 dígitos)."

    # Separação segura de primeiro nome e sobrenome
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

        return jsonify({
            'sucesso': True,
            'init_point': link_checkout,
            'sandbox_init_point': sandbox_init_point,
            'preference_id': preference.get('id')
        }), 200

    except Exception as e:
        # Não vazar detalhes internos da exceção ao cliente (Information Disclosure CWE-209)
        logging.error(f"Exceção interna ao gerar Checkout Pro: {str(e)}", exc_info=True)
        return jsonify({
            'sucesso': False, 
            'erro': 'Erro interno ao processar solicitação de pagamento.'
        }), 500


@app.route('/api/criar-pagamento-pix', methods=['POST'])
def criar_pagamento_pix():
    """Gera cobrança PIX com sanitização prévia."""
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

        payment_data = {
            'transaction_amount': valor,
            'description': f'Inscrição Retiro - {nome}',
            'payment_method_id': 'pix',
            'payer': {
                'email': email,
                'first_name': primeiro_nome,
                'last_name': sobrenome,
            },
        }

        logging.info(f"Requisitando Pix direto para '{nome}' com valor R$ {valor:.2f}")
        payment_response = sdk.payment().create(payment_data)
        pagamento = payment_response.get('response', {})

        point_of_interaction = pagamento.get('point_of_interaction', {})
        transaction_data = point_of_interaction.get('transaction_data', {})

        qr_code_base64 = transaction_data.get('qr_code_base64')
        qr_code_copia_cola = transaction_data.get('qr_code')

        if not qr_code_base64:
            msg_erro = pagamento.get('message') or 'Credencial não autorizada para Pix transparente.'
            logging.warning(f"Pix direto indisponível: {msg_erro}")
            return jsonify({
                'sucesso': False, 
                'erro': 'Pix transparente não disponível com a credencial atual. Utilize o Checkout Pro.',
                'precisa_checkout_pro': True
            }), 400

        return jsonify({
            'sucesso': True,
            'qr_code_imagem': f'data:image/png;base64,{qr_code_base64}',
            'qr_code_copia_cola': qr_code_copia_cola,
        }), 200

    except Exception as e:
        logging.error(f"Exceção interna ao gerar Pix: {str(e)}", exc_info=True)
        return jsonify({
            'sucesso': False, 
            'erro': 'Erro interno ao processar Pix.'
        }), 500


# ------------------------------------------------------------------------------
# 5. INICIALIZAÇÃO
# ------------------------------------------------------------------------------
if __name__ == '__main__':
    # Debug SEMPRE desligado por padrão; habilitável apenas via variável de ambiente explícita
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() in ('true', '1', 't')
    porta = int(os.getenv('PORT', 5000))
    logging.info(f"Iniciando servidor na porta {porta} (Debug={debug_mode})...")
    app.run(debug=debug_mode, port=porta)
app.run 
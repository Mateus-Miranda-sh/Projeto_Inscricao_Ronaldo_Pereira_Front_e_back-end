/**
 * Arquivo: js/pagamento.js
 * Descrição: Gerenciamento de tela, leitura do sessionStorage e integração de
 * pagamentos (Pix e Checkout Pro) com o Mercado Pago através do app.py.
 */

// 1. Configuração de URL da API (Render em produção ou Localhost em desenvolvimento)
const API_URL = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost')
    ? 'http://127.0.0.1:5000'
    : 'https://projeto-inscricao-ronaldo-pereira-front.onrender.com';

// 2. Mapeamento de Elementos do DOM
const resumoNome = document.getElementById('resumoNome');
const resumoValor = document.getElementById('resumoValor');

const btnOpcaoPix = document.getElementById('btnOpcaoPix');
const btnOpcaoCartao = document.getElementById('btnOpcaoCartao');

const areaPix = document.getElementById('areaPix');
const areaCartao = document.getElementById('areaCartao');
const qrContainer = document.querySelector('.qr-code-placeholder');
const btnCopiarPix = document.getElementById('btnCopiarPix');
const btnIrCartao = document.getElementById('btnIrCartao');

let codigoPixCopiaECola = '';

/**
 * Função segura para sanitizar o valor e evitar qualquer erro de valor nulo ou NaN.
 * @param {any} valorBruto 
 * @param {number} valorPadrao 
 * @returns {number}
 */
function sanitizarValor(valorBruto, valorPadrao = 80.0) {
    if (valorBruto === null || valorBruto === undefined || valorBruto === '') {
        return valorPadrao;
    }
    if (typeof valorBruto === 'number') {
        return isNaN(valorBruto) || valorBruto <= 0 ? valorPadrao : valorBruto;
    }
    const valorLimpo = String(valorBruto).replace(/[^0-9,\.]/g, '').replace(',', '.');
    const valorNumero = parseFloat(valorLimpo);
    return isNaN(valorNumero) || valorNumero <= 0 ? valorPadrao : valorNumero;
}

/**
 * Lê os dados da inscrição armazenados no sessionStorage.
 * Lê as chaves 'inscrito_*' e também as chaves alternativas ('nome', 'valor', etc).
 */
function obterDadosDoSessionStorage() {
    const nome = (
        sessionStorage.getItem('inscrito_nome') ||
        sessionStorage.getItem('nome') ||
        ''
    ).trim();

    const email = (
        sessionStorage.getItem('inscrito_email') ||
        sessionStorage.getItem('email') ||
        ''
    ).trim();

    const telefone = (
        sessionStorage.getItem('inscrito_telefone') ||
        sessionStorage.getItem('telefone') ||
        ''
    ).trim();

    const valorRaw = (
        sessionStorage.getItem('inscrito_valor') ||
        sessionStorage.getItem('valor')
    );

    const valor = sanitizarValor(valorRaw, 80.0);

    return {
        nome: nome || 'Inscrito do Retiro',
        email: email || 'contato@retiro.com',
        telefone: telefone,
        valor: valor,
        nomeInformado: Boolean(nome)
    };
}

/**
 * Atualiza o resumo visual da inscrição na página e inicia a solicitação do Pix.
 */
function carregarResumoInscricao() {
    const dados = obterDadosDoSessionStorage();

    if (resumoNome) {
        resumoNome.textContent = dados.nome;
    }

    if (resumoValor) {
        resumoValor.textContent = `R$ ${dados.valor.toFixed(2).replace('.', ',')}`;
    }

    // Dispara a geração inicial do QR Code Pix
    gerarPixNoServidor(dados.nome, dados.email, dados.valor);
}

/**
 * Alterna a visualização entre as abas PIX e Cartão de Crédito
 * @param {'pix'|'cartao'} forma 
 */
function alternarFormaPagamento(forma) {
    if (forma === 'pix') {
        btnOpcaoPix.classList.add('active');
        btnOpcaoCartao.classList.remove('active');
        areaPix.style.display = 'flex';
        areaCartao.style.display = 'none';
    } else {
        btnOpcaoCartao.classList.add('active');
        btnOpcaoPix.classList.remove('active');
        areaCartao.style.display = 'flex';
        areaPix.style.display = 'none';
    }
}

/**
 * Envia as informações para o endpoint /api/criar-pagamento-pix do Flask
 */
async function gerarPixNoServidor(nome, email, valor) {
    try {
        if (!qrContainer) return;
        qrContainer.innerHTML = `<div class="qr-fake">Gerando QR Code Pix...</div>`;

        const resposta = await fetch(`${API_URL}/api/criar-pagamento-pix`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                nome: nome, 
                email: email, 
                valor: sanitizarValor(valor, 80.0) 
            })
        });

        const dados = await resposta.json();

        // 1. Sucesso: QR Code gerado em Base64 e Chave Copia e Cola disponível
        if (dados.sucesso && dados.qr_code_imagem && dados.qr_code_copia_cola) {
            codigoPixCopiaECola = dados.qr_code_copia_cola;

            // Renderiza dinamicamente a tag <img> com o Base64 retornado pelo Mercado Pago
            qrContainer.innerHTML = `
                <img src="${dados.qr_code_imagem}" 
                     alt="QR Code Pix Mercado Pago" 
                     style="width: 100%; height: 100%; object-fit: contain; border-radius: 6px;">
            `;

            if (btnCopiarPix) {
                btnCopiarPix.textContent = 'Copiar Código PIX';
                btnCopiarPix.style.display = 'block';
            }
            console.log('✅ QR Code Pix e chave Copia e Cola renderizados com sucesso!');

        } else {
            // 2. Fallback amigável: Caso a credencial precise de homologação bancária no Mercado Pago
            console.warn('⚠️ Pix transparente indisponível na credencial atual:', dados);
            codigoPixCopiaECola = '';

            qrContainer.innerHTML = `
                <div class="qr-fake" style="color: #2d3748; font-size: 0.84rem; padding: 12px; line-height: 1.4; text-align: center;">
                    <span style="font-size: 1.3rem; display: block; margin-bottom: 4px;">⚡</span>
                    <strong style="color: #2b6cb0; display: block; margin-bottom: 4px;">Pagamento Seguro via PIX</strong>
                    <span style="font-size: 0.78rem; color: #718096; display: block; margin-bottom: 10px;">
                        Clique abaixo para gerar o QR Code oficial no ambiente do Mercado Pago:
                    </span>
                    <button type="button" id="btnPixCheckoutPro" class="btn-acao" style="padding: 10px 14px; font-size: 0.85rem; width: 100%; cursor: pointer;">
                        Abrir PIX no Mercado Pago &rarr;
                    </button>
                </div>
            `;

            // Vincula o botão interno à abertura segura do Checkout Pro
            const btnPixCheckout = document.getElementById('btnPixCheckoutPro');
            if (btnPixCheckout) {
                btnPixCheckout.addEventListener('click', iniciarCheckoutPro);
            }

            // Atualiza o botão de copiar para encaminhar ao Checkout Pro
            if (btnCopiarPix) {
                btnCopiarPix.textContent = 'Pagar PIX pelo Mercado Pago';
            }
        }
    } catch (erro) {
        console.error('Servidor offline ou erro de rede ao tentar gerar Pix:', erro);
        codigoPixCopiaECola = '';
        if (qrContainer) {
            qrContainer.innerHTML = `
                <div class="qr-fake" style="color: #e53e3e; font-size: 0.82rem; padding: 10px; text-align: center;">
                    Conectando ao servidor...<br>
                    <small style="color: #718096; display: block; margin-top: 4px;">Caso seja o primeiro acesso, o Render pode levar 30s para iniciar.</small>
                    <button type="button" id="btnTentarNovamentePix" style="margin-top: 8px; background: #edf2f7; border: 1px solid #cbd5e0; border-radius: 4px; padding: 4px 8px; font-size: 0.78rem; cursor: pointer;">
                        Tentar novamente
                    </button>
                </div>
            `;
            const btnTentar = document.getElementById('btnTentarNovamentePix');
            if (btnTentar) {
                btnTentar.addEventListener('click', () => carregarResumoInscricao());
            }
        }
    }
}

/**
 * Chama o backend Flask para criar a preferência e redireciona para o link do Checkout Pro do Mercado Pago.
 */
async function iniciarCheckoutPro() {
    const dados = obterDadosDoSessionStorage();

    if (btnIrCartao) {
        btnIrCartao.disabled = true;
        btnIrCartao.textContent = 'Conectando ao Mercado Pago...';
    }

    try {
        const resposta = await fetch(`${API_URL}/api/criar-preferencia`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nome: dados.nome,
                email: dados.email,
                telefone: dados.telefone,
                valor: dados.valor
            })
        });

        const resultado = await resposta.json();

        if (resultado.sucesso && resultado.init_point) {
            // Redireciona o participante para o Checkout Pro oficial do Mercado Pago
            window.location.href = resultado.init_point;
        } else {
            alert('Não foi possível abrir o Checkout Pro: ' + (resultado.erro || 'Erro ao comunicar com Mercado Pago'));
            if (btnIrCartao) {
                btnIrCartao.disabled = false;
                btnIrCartao.textContent = 'Continuar para o Mercado Pago';
            }
        }
    } catch (erro) {
        console.error('Erro de conexão com o servidor ao gerar Checkout Pro:', erro);
        alert(`Não foi possível conectar ao servidor (${API_URL}). Verifique sua conexão ou aguarde alguns segundos caso o servidor no Render esteja iniciando.`);
        if (btnIrCartao) {
            btnIrCartao.disabled = false;
            btnIrCartao.textContent = 'Continuar para o Mercado Pago';
        }
    }
}

// 2. Registro de Eventos
if (btnOpcaoPix) {
    btnOpcaoPix.addEventListener('click', () => alternarFormaPagamento('pix'));
}

if (btnOpcaoCartao) {
    btnOpcaoCartao.addEventListener('click', () => alternarFormaPagamento('cartao'));
}

if (btnIrCartao) {
    btnIrCartao.addEventListener('click', iniciarCheckoutPro);
}

if (btnCopiarPix) {
    btnCopiarPix.addEventListener('click', () => {
        if (codigoPixCopiaECola) {
            navigator.clipboard.writeText(codigoPixCopiaECola)
                .then(() => {
                    const textoOriginal = btnCopiarPix.textContent;
                    btnCopiarPix.textContent = '✅ Código PIX Copiado!';
                    setTimeout(() => {
                        btnCopiarPix.textContent = textoOriginal;
                    }, 3000);
                })
                .catch(() => {
                    // Fallback caso a Clipboard API seja bloqueada pelo navegador
                    const inputTemp = document.createElement('textarea');
                    inputTemp.value = codigoPixCopiaECola;
                    document.body.appendChild(inputTemp);
                    inputTemp.select();
                    document.execCommand('copy');
                    document.body.removeChild(inputTemp);
                    alert('Código PIX copiado com sucesso!');
                });
        } else {
            // Se o Pix direto ainda não gerou código (necessita homologação), encaminha para o Checkout Pro
            iniciarCheckoutPro();
        }
    });
}

// 3. Inicialização ao carregar a página
document.addEventListener('DOMContentLoaded', carregarResumoInscricao);

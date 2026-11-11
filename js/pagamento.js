/**
 * Arquivo: js/pagamento.js
 * Descrição: Gerenciamento de tela, leitura do sessionStorage e integração de
 * pagamentos (Pix e Checkout Pro) com o Mercado Pago através do app.py.
 */

// 1. Mapeamento de Elementos do DOM
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

        const resposta = await fetch('https://projeto-inscricao-ronaldo-pereira-front.onrender.com/api/criar-pagamento-pix', {
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

        if (dados.sucesso && dados.qr_code_imagem) {
            qrContainer.innerHTML = `<img src="${dados.qr_code_imagem}" alt="QR Code Pix" style="width: 100%; height: 100%; object-fit: contain; border-radius: 6px;">`;
            codigoPixCopiaECola = dados.qr_code_copia_cola || '';
        } else {
            console.warn('Resposta PIX:', dados);
            // Mensagem amigável com opção direta de pagar no Checkout Pro
            qrContainer.innerHTML = `
                <div class="qr-fake" style="color: #c53030; font-size: 0.82rem; padding: 6px;">
                    Pix direto requer homologação.<br>
                    <button type="button" id="btnPixCheckoutPro" style="background: none; border: none; color: #2b6cb0; font-weight: bold; text-decoration: underline; cursor: pointer; display: block; margin: 8px auto 0;">
                        Pagar no Checkout Pro do Mercado Pago &rarr;
                    </button>
                </div>
            `;
            const btnPixCheckout = document.getElementById('btnPixCheckoutPro');
            if (btnPixCheckout) {
                btnPixCheckout.addEventListener('click', iniciarCheckoutPro);
            }
        }
    } catch (erro) {
        console.error('Servidor Flask offline ou erro de rede:', erro);
        if (qrContainer) {
            qrContainer.innerHTML = `<div class="qr-fake" style="color: #e53e3e;">Servidor offline (Inicie o app.py no terminal)</div>`;
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
        const resposta = await fetch('https://projeto-inscricao-ronaldo-pereira-front.onrender.com/api/criar-preferencia', {
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
        alert('Não foi possível conectar ao servidor backend (app.py). Verifique se o Flask está rodando na porta 5000.');
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
                .then(() => alert('Código PIX copiado com sucesso!'))
                .catch(() => {
                    // Fallback caso a API de Clipboard não tenha permissão
                    const inputTemp = document.createElement('textarea');
                    inputTemp.value = codigoPixCopiaECola;
                    document.body.appendChild(inputTemp);
                    inputTemp.select();
                    document.execCommand('copy');
                    document.body.removeChild(inputTemp);
                    alert('Código PIX copiado com sucesso!');
                });
        } else {
            alert('O código PIX ainda não está disponível ou utilize o botão do Mercado Pago.');
        }
    });
}

// 3. Inicialização ao carregar a página
document.addEventListener('DOMContentLoaded', carregarResumoInscricao);

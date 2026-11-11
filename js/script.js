/**
 * Arquivo: js/script.js
 * Descrição: Controle do formulário de inscrição do Retiro de Mudança de Fase.
 * Mapeado exatamente para as tags do index.html.
 */

// 1. Mapeamento de Elementos do DOM
const formInscricao = document.getElementById('forInscricao');
const valorTotalDisplay = document.getElementById('valorTotalDaInscricao');
const radiosInscricao = document.querySelectorAll('input[name="opcaoInscricao"]');

/**
 * Atualiza o texto do valor total (R$ 50,00 ou R$ 80,00) com animação de pulso
 */
function atualizarValorTotal() {
    const opcaoSelecionada = document.querySelector('input[name="opcaoInscricao"]:checked');
    
    if (opcaoSelecionada) {
        const valorFormatado = parseFloat(opcaoSelecionada.value).toFixed(2).replace('.', ',');
        valorTotalDisplay.textContent = `R$ ${valorFormatado}`;
        
        // Pulso visual ao mudar a opção
        valorTotalDisplay.classList.add('animar-troca');
        setTimeout(() => {
            valorTotalDisplay.classList.remove('animar-troca');
        }, 200);
    }
}

/**
 * Captura o envio do formulário, grava na sessão e navega para a tela de pagamento
 * @param {Event} event 
 */
function processarEnvioInscricao(event) {
    event.preventDefault(); // Impede recarregamento da página

    const nomeOvelha = document.getElementById('nome')?.value.trim() || '';
    const emailOvelha = document.getElementById('email')?.value.trim() || '';
    const telefoneOvelha = document.getElementById('telefone')?.value.trim() || '';
    const radioSelecionado = document.querySelector('input[name="opcaoInscricao"]:checked');
    const opcaoSelecionada = radioSelecionado ? radioSelecionado.value : '80';

    if (!nomeOvelha) {
        alert('Por favor, informe seu nome completo.');
        return;
    }

    // Guarda no sessionStorage com as chaves principais e aliases para compatibilidade
    sessionStorage.setItem('inscrito_nome', nomeOvelha);
    sessionStorage.setItem('inscrito_email', emailOvelha);
    sessionStorage.setItem('inscrito_telefone', telefoneOvelha);
    sessionStorage.setItem('inscrito_valor', opcaoSelecionada);

    // Aliases para evitar qualquer erro de leitura
    sessionStorage.setItem('nome', nomeOvelha);
    sessionStorage.setItem('email', emailOvelha);
    sessionStorage.setItem('telefone', telefoneOvelha);
    sessionStorage.setItem('valor', opcaoSelecionada);

    // Redireciona para a tela de pagamento
    window.location.href = 'pagamento.html';
}

// 2. Registra os escutadores de eventos
radiosInscricao.forEach(radio => {
    radio.addEventListener('change', atualizarValorTotal);
});

formInscricao.addEventListener('submit', processarEnvioInscricao);

// Inicialização
document.addEventListener('DOMContentLoaded', atualizarValorTotal);
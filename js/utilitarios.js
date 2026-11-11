/**
 * Arquivo: js/utilitarios.js
 * Descrição: Funções utilitárias para formatação de moeda, manipulação de dados
 * e leitura resiliente do sessionStorage do Retiro Ronaldo Pereira.
 */

/**
 * Converte qualquer valor (string com "R$", vírgula, nulo, número) em número Float válido.
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
 * Formata um valor numérico para o padrão de moeda brasileiro (R$ XX,XX).
 * @param {number|string} valor 
 * @returns {string}
 */
function formatarMoeda(valor) {
    const numero = sanitizarValor(valor);
    return `R$ ${numero.toFixed(2).replace('.', ',')}`;
}

/**
 * Lê os dados da inscrição armazenados no sessionStorage de forma resiliente,
 * verificando tanto as chaves com prefixo (inscrito_*) quanto as chaves diretas.
 * @returns {{nome: string, email: string, telefone: string, valor: number, nomeValido: boolean}}
 */
function obterDadosInscricao() {
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
        nome: nome,
        email: email,
        telefone: telefone,
        valor: valor,
        nomeValido: Boolean(nome)
    };
}

/**
 * Grava os dados da inscrição no sessionStorage garantindo todas as chaves.
 * @param {{nome: string, email: string, telefone: string, valor: string|number}} dados 
 */
function salvarDadosInscricao(dados) {
    if (!dados) return;

    if (dados.nome) {
        sessionStorage.setItem('inscrito_nome', dados.nome);
        sessionStorage.setItem('nome', dados.nome);
    }
    if (dados.email) {
        sessionStorage.setItem('inscrito_email', dados.email);
        sessionStorage.setItem('email', dados.email);
    }
    if (dados.telefone) {
        sessionStorage.setItem('inscrito_telefone', dados.telefone);
        sessionStorage.setItem('telefone', dados.telefone);
    }
    if (dados.valor !== undefined && dados.valor !== null) {
        const valorFormatado = String(dados.valor);
        sessionStorage.setItem('inscrito_valor', valorFormatado);
        sessionStorage.setItem('valor', valorFormatado);
    }
}

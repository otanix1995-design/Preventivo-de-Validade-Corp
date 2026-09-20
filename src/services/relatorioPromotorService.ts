/**
 * Serviço de Geração de Relatórios Mensais de Promotores
 * 
 * Gera relatórios sob demanda em formatos PDF e EXCEL (XLSX)
 * Fonte dos dados: solicitacoesVencimentoPromotor
 * O mês é determinado estritamente pela DATA DO ENVIO DO PROMOTOR.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  FiltrosHistoricoPromotor,
  ResumoHistoricoPromotor,
  SolicitacaoVencimentoPromotor
} from '../types';
import { formatarDataBR } from './projection';

export class RelatorioPromotorService {
  /**
   * Formata período YYYY-MM para exibição amigável em português (ex: SETEMBRO/2026)
   */
  public static formatarPeriodoExtenso(mesAno: string): string {
    if (!mesAno) return 'TODOS OS PERÍODOS';
    const partes = mesAno.split('-');
    if (partes.length !== 2) return mesAno.toUpperCase();
    const [ano, mes] = partes;
    const meses = [
      'JANEIRO',
      'FEVEREIRO',
      'MARÇO',
      'ABRIL',
      'MAIO',
      'JUNHO',
      'JULHO',
      'AGOSTO',
      'SETEMBRO',
      'OUTUBRO',
      'NOVEMBRO',
      'DEZEMBRO',
    ];
    const idx = parseInt(mes, 10) - 1;
    const nomeMes = meses[idx] || mes;
    return `${nomeMes}/${ano}`;
  }

  /**
   * Formata data e hora para exibição padrão brasileira (DD/MM/AAAA HH:mm)
   */
  public static formatarDataHoraBR(isoString?: string): string {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const ano = d.getFullYear();
      const hora = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${dia}/${mes}/${ano} ${hora}:${min}`;
    } catch {
      return isoString;
    }
  }

  /**
   * Formata texto do resultado da análise
   */
  public static formatarResultadoAnalise(solic: SolicitacaoVencimentoPromotor): string {
    if (solic.status === 'RECUSADO') {
      return 'RECUSADO';
    }
    if (solic.status === 'PENDENTE_ANALISE') {
      return 'PENDENTE';
    }
    if (solic.resultadoAprovacao === 'QUANTIDADE_ATUALIZADA') {
      return 'ATUALIZAÇÃO DE QUANTIDADE';
    }
    if (solic.resultadoAprovacao === 'NOVO_VENCIMENTO') {
      return 'NOVO VENCIMENTO';
    }
    return 'APROVADO';
  }

  /**
   * Gera e faz o download do Relatório em PDF
   */
  public static gerarPDF(params: {
    solicitacoes: SolicitacaoVencimentoPromotor[];
    filtros: FiltrosHistoricoPromotor;
    resumo: ResumoHistoricoPromotor;
    filialId?: string;
    filialNome?: string;
    promotorNomeExibicao?: string;
    industriaAgenciaExibicao?: string;
  }): void {
    const {
      solicitacoes,
      filtros,
      resumo,
      filialId = '172',
      filialNome = 'CASCAVEL',
      promotorNomeExibicao = 'TODOS OS PROMOTORES',
      industriaAgenciaExibicao = 'TODAS AS INDÚSTRIAS / AGÊNCIAS',
    } = params;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const periodoExtenso = this.formatarPeriodoExtenso(filtros.mesAno);
    const dataHoraEmissao = this.formatarDataHoraBR(new Date().toISOString());

    // --- CABEÇALHO DO RELATÓRIO ---
    doc.setFillColor(30, 58, 138); // Azul Marinho Corporativo
    doc.rect(10, 8, 277, 24, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text('CONTROLE DE VENCIMENTOS', 15, 15);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`FILIAL ${filialId} — ${filialNome.toUpperCase()}`, 15, 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('RELATÓRIO MENSAL DO PROMOTOR', 15, 27);

    // Dados do Filtro / Contexto à direita do cabeçalho
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(224, 231, 255);
    doc.text(`Promotor: ${promotorNomeExibicao.toUpperCase()}`, 160, 15);
    doc.text(`Indústria/Agência: ${industriaAgenciaExibicao.toUpperCase()}`, 160, 20);
    doc.text(`Período: ${periodoExtenso}  |  Emissão: ${dataHoraEmissao}`, 160, 25);
    if (filtros.setor !== 'TODOS' || filtros.status !== 'TODOS') {
      doc.text(
        `Filtros adicionais: Setor [${filtros.setor}] | Status [${filtros.status}]`,
        160,
        29
      );
    }

    // --- PAINEL DE TOTAIS / RESUMO DO MÊS ---
    const startY = 36;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.rect(10, startY, 277, 13, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);

    const resumoCols = [
      { label: 'TOTAL DE ENVIOS', val: resumo.totalEnvios, color: [30, 41, 59] },
      { label: 'APROVADOS', val: resumo.aprovados, color: [22, 101, 52] },
      { label: 'RECUSADOS', val: resumo.recusados, color: [153, 27, 27] },
      { label: 'PENDENTES', val: resumo.pendentes, color: [180, 83, 9] },
      { label: 'NOVOS VENCIMENTOS', val: resumo.novosVencimentos, color: [30, 58, 138] },
      { label: 'ATUALIZAÇÕES QUANTIDADE', val: resumo.atualizacoesQuantidade, color: [109, 40, 217] },
    ];

    const cardWidth = 277 / resumoCols.length;
    resumoCols.forEach((col, idx) => {
      const x = 10 + idx * cardWidth;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(col.label, x + 3, startY + 5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(col.color[0], col.color[1], col.color[2]);
      doc.text(String(col.val), x + 3, startY + 10.5);
    });

    // --- TABELA DE SOLICITAÇÕES ---
    const tableData = solicitacoes.map((s) => {
      const dataEnvioFormatada = this.formatarDataHoraBR(s.enviadoEm);
      const codigoFormatado = s.codigoCompleto || (s.digito ? `${s.codigoInterno}-${s.digito}` : s.codigoInterno);
      const eanFormatado = s.ean || (s.eans && s.eans[0]) || '-';
      const validadeFormatada = s.dataVencimento ? formatarDataBR(s.dataVencimento) : '-';
      const qtdInformada = s.quantidadeInformada !== undefined ? `${s.quantidadeInformada} ${s.unidade_medida || 'UN'}` : '-';
      const qtdAnterior = s.quantidadeAnterior !== undefined ? `${s.quantidadeAnterior} ${s.unidade_medida || 'UN'}` : '-';
      const qtdAprovada = s.quantidadeAprovada !== undefined ? `${s.quantidadeAprovada} ${s.unidade_medida || 'UN'}` : s.status === 'APROVADO' ? `${s.quantidadeInformada} ${s.unidade_medida || 'UN'}` : '-';
      const resultado = this.formatarResultadoAnalise(s);
      const statusLabel = s.status === 'APROVADO' ? 'APROVADO' : s.status === 'RECUSADO' ? 'RECUSADO' : 'PENDENTE';
      const dataAnalise = this.formatarDataHoraBR(s.dataAnalise || s.aprovadoEm || s.recusadoEm);
      const analisadoPor = s.analisadoPor || s.aprovadoPor || s.recusadoPor || '-';
      const motivoRecusa = s.motivoRecusa || '-';

      return [
        dataEnvioFormatada,
        s.descricao || 'SEM DESCRIÇÃO',
        codigoFormatado,
        eanFormatado,
        s.setor || s.setorTipo || '-',
        validadeFormatada,
        qtdInformada,
        qtdAnterior,
        qtdAprovada,
        resultado,
        statusLabel,
        dataAnalise,
        analisadoPor,
        motivoRecusa,
      ];
    });

    autoTable(doc, {
      startY: startY + 16,
      head: [
        [
          'DATA DO ENVIO',
          'PRODUTO',
          'CÓDIGO',
          'EAN',
          'SETOR',
          'VALIDADE',
          'QTD. INFORMADA',
          'QTD. ANTERIOR',
          'QTD. APROVADA',
          'RESULTADO',
          'STATUS',
          'DATA ANÁLISE',
          'ANALISADO POR',
          'MOTIVO DA RECUSA',
        ],
      ],
      body: tableData,
      theme: 'grid',
      styles: {
        fontSize: 7,
        cellPadding: 1.5,
        valign: 'middle',
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7,
        halign: 'center',
      },
      columnStyles: {
        0: { cellWidth: 22, halign: 'center' }, // Data envio
        1: { cellWidth: 42 },                   // Produto
        2: { cellWidth: 16, halign: 'center' }, // Código
        3: { cellWidth: 20, halign: 'center' }, // EAN
        4: { cellWidth: 14, halign: 'center' }, // Setor
        5: { cellWidth: 16, halign: 'center' }, // Validade
        6: { cellWidth: 18, halign: 'right' },  // Qtd Inf
        7: { cellWidth: 18, halign: 'right' },  // Qtd Ant
        8: { cellWidth: 18, halign: 'right' },  // Qtd Apr
        9: { cellWidth: 23, halign: 'center' }, // Resultado
        10: { cellWidth: 16, halign: 'center' },// Status
        11: { cellWidth: 20, halign: 'center' },// Data análise
        12: { cellWidth: 16, halign: 'center' },// Analisado por
        13: { cellWidth: 18 },                  // Motivo recusa
      },
      didDrawPage: (data) => {
        // Rodapé em todas as páginas
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Controle de Vencimentos • Filial ${filialId} • Relatório Oficial de Promotores • Página ${data.pageNumber} de ${pageCount}`,
          10,
          205
        );
      },
    });

    const nomeArquivo = `RELATORIO_PROMOTOR_${filialId}_${filtros.mesAno.replace('-', '_')}_${promotorNomeExibicao.replace(/\s+/g, '_')}.pdf`;
    doc.save(nomeArquivo);
  }

  /**
   * Gera e faz o download do Relatório em EXCEL (.xlsx)
   */
  public static gerarExcel(params: {
    solicitacoes: SolicitacaoVencimentoPromotor[];
    filtros: FiltrosHistoricoPromotor;
    resumo: ResumoHistoricoPromotor;
    filialId?: string;
    filialNome?: string;
    promotorNomeExibicao?: string;
    industriaAgenciaExibicao?: string;
  }): void {
    const {
      solicitacoes,
      filtros,
      resumo,
      filialId = '172',
      filialNome = 'CASCAVEL',
      promotorNomeExibicao = 'TODOS OS PROMOTORES',
      industriaAgenciaExibicao = 'TODAS AS INDÚSTRIAS / AGÊNCIAS',
    } = params;

    const periodoExtenso = this.formatarPeriodoExtenso(filtros.mesAno);
    const dataHoraEmissao = this.formatarDataHoraBR(new Date().toISOString());

    // Linhas estruturadas de Cabeçalho e Metadados
    const rows: any[][] = [
      ['CONTROLE DE VENCIMENTOS', `FILIAL ${filialId} — ${filialNome.toUpperCase()}`],
      ['RELATÓRIO MENSAL DO PROMOTOR', ''],
      [`Promotor: ${promotorNomeExibicao}`, `Indústria/Agência: ${industriaAgenciaExibicao}`],
      [`Período: ${periodoExtenso}`, `Data de Emissão: ${dataHoraEmissao}`],
      [`Filtro Setor: ${filtros.setor}`, `Filtro Status: ${filtros.status}`],
      [], // Linha em branco

      // Bloco de Totais
      ['RESUMO DO MÊS:', ''],
      ['Total de produtos enviados', resumo.totalEnvios],
      ['Total aprovado', resumo.aprovados],
      ['Total recusado', resumo.recusados],
      ['Total pendente', resumo.pendentes],
      ['Total de novos vencimentos', resumo.novosVencimentos],
      ['Total de atualizações de quantidade', resumo.atualizacoesQuantidade],
      [], // Linha em branco

      // Cabeçalho das Colunas
      [
        'DATA DO ENVIO',
        'PRODUTO',
        'CÓDIGO',
        'EAN',
        'SETOR',
        'VALIDADE',
        'QUANTIDADE INFORMADA',
        'QUANTIDADE ANTERIOR',
        'QUANTIDADE APROVADA',
        'RESULTADO',
        'STATUS',
        'DATA DA ANÁLISE',
        'ANALISADO POR',
        'MOTIVO DA RECUSA',
        'PROMOTOR',
        'INDÚSTRIA / AGÊNCIA',
      ],
    ];

    // Linhas de dados
    solicitacoes.forEach((s) => {
      const codigoFormatado = s.codigoCompleto || (s.digito ? `${s.codigoInterno}-${s.digito}` : s.codigoInterno);
      const eanFormatado = s.ean || (s.eans && s.eans[0]) || '';
      const validadeFormatada = s.dataVencimento ? formatarDataBR(s.dataVencimento) : '';
      const resultado = this.formatarResultadoAnalise(s);
      const statusLabel = s.status === 'APROVADO' ? 'APROVADO' : s.status === 'RECUSADO' ? 'RECUSADO' : 'PENDENTE';
      const dataAnalise = this.formatarDataHoraBR(s.dataAnalise || s.aprovadoEm || s.recusadoEm);

      rows.push([
        this.formatarDataHoraBR(s.enviadoEm),
        s.descricao || '',
        codigoFormatado,
        eanFormatado,
        s.setor || s.setorTipo || '',
        validadeFormatada,
        s.quantidadeInformada ?? '',
        s.quantidadeAnterior ?? '',
        s.quantidadeAprovada ?? (s.status === 'APROVADO' ? s.quantidadeInformada : ''),
        resultado,
        statusLabel,
        dataAnalise,
        s.analisadoPor || s.aprovadoPor || s.recusadoPor || '',
        s.motivoRecusa || '',
        s.promotorNome || '',
        s.agencia || s.agenciaNome || s.industriaAgencia || '',
      ]);
    });

    // Linha de Rodapé com Totais
    rows.push([]);
    rows.push([
      'TOTAIS FINAIS:',
      `Total Enviado: ${resumo.totalEnvios}`,
      '',
      '',
      '',
      '',
      `Aprovados: ${resumo.aprovados}`,
      `Recusados: ${resumo.recusados}`,
      `Pendentes: ${resumo.pendentes}`,
      `Novos: ${resumo.novosVencimentos}`,
      `Atualizações: ${resumo.atualizacoesQuantidade}`,
    ]);

    // Criar planilha e workbook
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Ajustar larguras das colunas
    ws['!cols'] = [
      { wch: 18 }, // Data envio
      { wch: 40 }, // Descrição produto
      { wch: 14 }, // Código
      { wch: 16 }, // EAN
      { wch: 12 }, // Setor
      { wch: 14 }, // Validade
      { wch: 20 }, // Qtd Informada
      { wch: 20 }, // Qtd Anterior
      { wch: 20 }, // Qtd Aprovada
      { wch: 25 }, // Resultado
      { wch: 14 }, // Status
      { wch: 18 }, // Data análise
      { wch: 18 }, // Analisado por
      { wch: 30 }, // Motivo recusa
      { wch: 20 }, // Promotor
      { wch: 22 }, // Agência
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Histórico Promotores');

    const nomeArquivo = `RELATORIO_PROMOTOR_${filialId}_${filtros.mesAno.replace('-', '_')}_${promotorNomeExibicao.replace(/\s+/g, '_')}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
  }
}

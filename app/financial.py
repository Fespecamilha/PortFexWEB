"""
Portfex Web — Financial Logic
All financial calculations: quotes, FCD, Graham, EV/EBITDA, IR, proventos.
"""
import urllib.request, urllib.error, urllib.parse
import json, re, io, zipfile, csv, time
from datetime import datetime, date

# yfinance removed - too heavy for Render free tier (causes OOM kills)
# Using brapi.dev REST API instead (fast, no installation, Brazilian stocks)
YF_SUPPORT = False
yf = None

try:
    import pdfplumber
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                     Table, TableStyle, HRFlowable)
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    PDF_GEN_SUPPORT = True
except ImportError:
    PDF_GEN_SUPPORT = False



NOME_TICKER = {
    "SAO MARTINHO":"SMTO3","PETROBRAS PN":"PETR4","PETROBRAS ON":"PETR3",
    "VALE":"VALE3","ITAUUNIBANCO":"ITUB4","ITAU UNIBANCO":"ITUB4",
    "BRADESCO":"BBDC4","BRADESCO ON":"BBDC3","BANCO DO BRASIL":"BBAS3",
    "BRADSAUDE":"SAUD3","BRADESCO SAUDE":"SAUD3","BRADSAUDE ON":"SAUD3",
    "AMBEV":"ABEV3","WEG":"WEGE3","MAGAZINE LUIZA":"MGLU3","LOCALIZA":"RENT3",
    "TOTVS":"TOTS3","EMBRAER":"EMBR3","GERDAU":"GGBR4","SUZANO":"SUZB3",
    "KLABIN":"KLBN11","LOJAS RENNER":"LREN3","AREZZO":"ARZZ3","NATURA":"NTCO3",
    "B3 SA":"B3SA3","TAESA":"TAEE11","ENGIE":"EGIE3","CEMIG":"CMIG4",
    "COPEL":"CPLE6","SABESP":"SBSP3","EQUATORIAL":"EQTL3","FLEURY":"FLRY3",
    "HAPVIDA":"HAPV3","RAIA DROGASIL":"RADL3","VIBRA":"VBBR3","HYPERA":"HYPE3",
    "MRV":"MRVE3","CYRELA":"CYRE3","EZTEC":"EZTC3","INTELBRAS":"INTB3",
    "HGLG":"HGLG11","XPLG":"XPLG11","MXRF":"MXRF11","KNRI":"KNRI11",
    "VISC":"VISC11","XPML":"XPML11","HSML":"HSML11","BCFF":"BCFF11",
    "CSHG":"HGRU11","XPCA":"XPCA11","BRCO":"BRCO11","PVBI":"PVBI11",
}

IBOV_TOP30 = [
    "PETR4","VALE3","ITUB4","BBDC4","BBAS3","B3SA3","ABEV3","WEGE3",
    "RENT3","SUZB3","LREN3","EQTL3","EMBR3","EGIE3","CPLE6","SAPR4",
    "KLBN11","RADL3","HYPE3","TOTS3","SOMA3","VBBR3","CSAN3","MRVE3",
    "MULT3","SBSP3","CMIG4","TAEE11","VIVT3","NTCO3"
]

TICKER_CVM = {
    "PETR4":"9512","PETR3":"9512","VALE3":"4170","ITUB4":"19348","ITUB3":"19348",
    "BBDC4":"906","BBDC3":"906","BBAS3":"1023","B3SA3":"23264","ABEV3":"6437",
    "WEGE3":"5410","RENT3":"20656","SUZB3":"21261","LREN3":"12793","EQTL3":"23264",
    "EMBR3":"8370","EGIE3":"21105","CPLE6":"6491","SAPR4":"8028","KLBN11":"12653",
    "RADL3":"22187","HYPE3":"21156","TOTS3":"18074","SOMA3":"24805","VBBR3":"23264",
    "CSAN3":"22608","MRVE3":"23516","MULT3":"18066","SBSP3":"14176","CMIG4":"1432",
    "TAEE11":"23264","VIVT3":"22344","NTCO3":"25925",
    # Carteira Felipe
    "RAPT4":"6653","RANI3":"8370","WIZC3":"23264","EZTC3":"21520","SIMH3":"23264",
    "MXRF11":"23264","JALL3":"23264","DEXP3":"23264","AGRO3":"23264","RECV3":"23264",
    "FESA4":"3743","TUPY3":"22527","UNIP6":"13773","KEPL3":"23264","SHUL4":"23264",
    "CPLE3":"6491","TTEN3":"23264","SMTO3":"16101","SAUD3":"23264",
}

_cvm_cache = {}


MULTIPLOS_SETOR = {
    "Energy": 5.0, "Basic Materials": 5.5, "Financial Services": 8.0,
    "Utilities": 7.0, "Consumer Defensive": 9.0, "Healthcare": 11.0,
    "Industrials": 9.0, "Technology": 14.0, "Real Estate": 14.0,
    "Consumer Cyclical": 8.0, "Communication Services": 10.0,
}

def nome_para_ticker(nome):
    n = nome.upper().strip()
    for suf in [" ON NM"," PN NM"," ON EJ"," PN EJ"," UNT N2"," UNT NM",
                " ON N1"," ON N2"," ON"," PN"," UNT"," NM"," N2"," N1",
                " MB"," DR1"," DR2"," DR3"," EJ"," MA"," ED"," EB"," B"]:
        n = n.replace(suf, "")
    n = n.strip()
    if n in NOME_TICKER: return NOME_TICKER[n]
    for k,v in NOME_TICKER.items():
        if k in n or n in k: return v
    return ""

def _pnum(txt):
    if not txt: return 0.0
    try: return float(re.sub(r"[^\d,\.]","",str(txt)).replace(",","."))
    except: return 0.0

def parse_rico_pdf(pdf_bytes):
    result={"nr_nota":"","data_pregao":"","cliente":"","cpf":"",
            "negocios":[],"taxas":{},"liquido":0.0,"data_liquidacao":"",
            "erros":[],"pdf_support":PDF_SUPPORT}
    if not PDF_SUPPORT:
        result["erros"].append("Execute: pip install pdfplumber e reinicie o Portfex.")
        return result
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            text="\n".join(p.extract_text() or "" for p in pdf.pages)

        # ── Cabeçalho ─────────────────────────────────────────
        m=re.search(r"Nr\.\s*nota\s+Folha\s+Data pregão\s+(\d+)\s+\d+\s+(\d{2}/\d{2}/\d{4})",text)
        if m: result["nr_nota"]=m.group(1); result["data_pregao"]=m.group(2)
        m2=re.search(r"\d{7}\s+(.+?)\s+(\d{3}\.\d{3}\.\d{3}-\d{2})",text)
        if m2: result["cliente"]=m2.group(1).strip(); result["cpf"]=m2.group(2)

        # ── Negócios — parse direto do texto (mais confiável) ──
        # Captura todas as linhas: 1-BOVESPA C/V TIPO TITULO OBS QTD PRECO VALOR D/C
        pat = r"1-BOVESPA\s+(C|V)\s+(\S+)\s+(.+?)\s+([#@\w]+)\s+(\d+)\s+([\d,\.]+)\s+([\d,\.]+)\s+(D|C)\b"
        matches = re.findall(pat, text)

        # Consolida linhas do mesmo ativo+cv+preco
        from collections import OrderedDict
        groups = OrderedDict()
        for cv, tipo, titulo, obs, qtd, preco, valor, dc in matches:
            titulo = titulo.strip()
            preco_f = _pnum(preco)
            key = (titulo, cv, preco_f)
            if key not in groups:
                groups[key] = {"cv":cv,"tipo_mercado":tipo,"titulo":titulo,
                               "obs":obs,"qtd":0,"preco":preco_f,
                               "valor_operacao":0.0,"dc":dc,
                               "fracionario":"FRACION" in tipo.upper() or "@" in obs,
                               "day_trade":"D" in obs and "@" not in obs}
            groups[key]["qtd"] += int(qtd)
            groups[key]["valor_operacao"] = round(groups[key]["valor_operacao"] + _pnum(valor), 2)

        for neg in groups.values():
            neg["ticker"] = nome_para_ticker(neg["titulo"])
            neg["taxas_prop"] = 0.0
            neg["custo_total"] = neg["valor_operacao"]
            neg["pm_real"] = round(neg["valor_operacao"] / neg["qtd"], 4) if neg["qtd"] else neg["preco"]
            result["negocios"].append(neg)

        # ── Taxas ──────────────────────────────────────────────
        for key,pat in [("taxa_liquidacao",r"Taxa de liquidação\s+([\d,\.]+)"),
                        ("emolumentos",r"Emolumentos\s+([\d,\.]+)"),
                        ("taxa_transf",r"Taxa de Transf\. de Ativos\s+([\d,\.]+)"),
                        ("taxa_operacional",r"Taxa Operacional\s+([\d,\.]+)"),
                        ("compras_vista",r"Compras à vista\s+([\d,\.]+)"),
                        ("vendas_vista",r"Vendas à vista\s+([\d,\.]+)")]:
            m=re.search(pat,text)
            if m: result["taxas"][key]=_pnum(m.group(1))
        m3=re.search(r"Líquido para (\d{2}/\d{2}/\d{4})\s+([\d,\.]+)",text)
        if m3: result["data_liquidacao"]=m3.group(1); result["liquido"]=_pnum(m3.group(2))

        # ── Distribui taxas proporcionalmente ─────────────────
        if result["negocios"]:
            total_op = sum(n["valor_operacao"] for n in result["negocios"]) or 1
            total_tx = sum(result["taxas"].get(k,0) for k in ["taxa_liquidacao","emolumentos","taxa_transf","taxa_operacional"])
            for n in result["negocios"]:
                p = n["valor_operacao"] / total_op
                n["taxas_prop"]  = round(total_tx * p, 4)
                n["custo_total"] = round(n["valor_operacao"] + n["taxas_prop"], 2)
                n["pm_real"]     = round(n["custo_total"] / n["qtd"], 4) if n["qtd"] else n["preco"]
    except Exception as e:
        result["erros"].append(str(e))
    return result

def gerar_pdf_ir(posicoes, notas, ano):
    """Gera PDF formatado para declaração de IR."""
    if not PDF_GEN_SUPPORT:
        return None

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2.5*cm, bottomMargin=2*cm,
        title=f"Portfex — Declaração IR {ano}"
    )

    GOLD  = colors.HexColor('#c9a84c')
    DARK  = colors.HexColor('#1a1a2e')
    LIGHT = colors.HexColor('#f5f0e8')
    GRAY  = colors.HexColor('#6b6b6b')
    WHITE = colors.white

    styles = getSampleStyleSheet()
    def S(name, **kw):
        return ParagraphStyle(name, parent=styles['Normal'], **kw)

    S_h2      = S('h2',  fontName='Helvetica-Bold',    fontSize=12, textColor=DARK, spaceBefore=14, spaceAfter=6)
    S_body    = S('bd',  fontName='Helvetica',          fontSize=9,  textColor=DARK, spaceAfter=4, leading=14)
    S_instruc = S('ins', fontName='Helvetica-Oblique',  fontSize=8.5, textColor=colors.HexColor('#444466'),
                  spaceAfter=6, leading=13, backColor=colors.HexColor('#f0f0f8'),
                  borderColor=GOLD, borderWidth=0.5, borderPad=6)
    S_lbl     = S('lb',  fontName='Helvetica-Bold',     fontSize=8,  textColor=GRAY)
    S_val     = S('vl',  fontName='Helvetica',           fontSize=9,  textColor=DARK, leading=13)
    S_foot    = S('ft',  fontName='Helvetica-Oblique',   fontSize=7.5, textColor=GRAY, alignment=TA_CENTER)

    def fmt(v):
        return f"R$ {abs(v):,.2f}".replace(",","X").replace(".",",").replace("X",".")

    story = []

    # ── Cabeçalho ──────────────────────────────────────────────
    hdr = Table([[
        Paragraph("<b>Portfex</b>", S('hb', fontName='Helvetica-Bold', fontSize=22, textColor=GOLD)),
        Paragraph(f"Relatório para Declaração de IR<br/>"
                  f"<font size='9' color='#888888'>Ano-Calendário {ano}</font>",
                  S('hr', fontName='Helvetica', fontSize=11, textColor=DARK))
    ]], colWidths=[6*cm, 11*cm])
    hdr.setStyle(TableStyle([
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),('ALIGN',(1,0),(1,0),'RIGHT'),
        ('LINEBELOW',(0,0),(-1,0),1.5,GOLD),('BOTTOMPADDING',(0,0),(-1,0),8),
    ]))
    story += [Spacer(1,0.3*cm), hdr, Spacer(1,0.4*cm)]

    story.append(Paragraph(
        "⚠ Relatório gerado com base nas notas de corretagem importadas. "
        "Confira com o informe de rendimentos da corretora antes de declarar.",
        S('av', fontName='Helvetica-Oblique', fontSize=8, textColor=colors.HexColor('#665500'),
          backColor=colors.HexColor('#fffbe6'), borderColor=GOLD, borderWidth=0.5,
          borderPad=6, spaceAfter=14, leading=13)
    ))

    pos_list = [p for p in posicoes.values() if p.get('ano')==ano and p.get('qtd',0)>0]
    notas_ano = [n for n in notas if n.get('data_pregao','').endswith(ano)]
    todas_vendas = [v for p in posicoes.values() if p.get('ano')==ano for v in p.get('vendas',[])]

    # ── 1. Bens e Direitos ─────────────────────────────────────
    story.append(Paragraph("1. BENS E DIREITOS", S_h2))
    story.append(HRFlowable(width="100%", thickness=1, color=GOLD, spaceAfter=8))
    story.append(Paragraph(
        "No IRPF acesse <b>Bens e Direitos</b> e adicione/atualize cada ativo:<br/>"
        "• Ações → Grupo <b>03</b> — Código <b>01</b> (Ações negociadas em bolsa)<br/>"
        "• FIIs  → Grupo <b>07</b> — Código <b>03</b> (Fundos de Investimento Imobiliário)<br/>"
        "• Preencha CNPJ, quantidade e o <b>Custo de Aquisição</b> (não use valor de mercado).",
        S_instruc
    ))
    story.append(Spacer(1,0.2*cm))

    if pos_list:
        for pos in sorted(pos_list, key=lambda x: x['ticker']):
            t = pos['ticker']; qtd = pos['qtd']
            custo = pos['custo_total']; pm = pos['pm']
            is_fii = t.endswith('11')
            grupo = "Grupo 07 — Código 03 (FII)" if is_fii else "Grupo 03 — Código 01 (Ação)"

            # Header do ativo
            ah = Table([[
                Paragraph(f"<b>{t}</b>", S('th', fontName='Helvetica-Bold', fontSize=14, textColor=DARK)),
                Paragraph(f"{'Fundo Imobiliário' if is_fii else 'Ação'}", S('tp', fontName='Helvetica', fontSize=9, textColor=GRAY))
            ]], colWidths=[4*cm, 13*cm])
            ah.setStyle(TableStyle([
                ('BACKGROUND',(0,0),(-1,-1),LIGHT),
                ('LINEABOVE',(0,0),(-1,0),2,GOLD),
                ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),4),
                ('LEFTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
            ]))
            story.append(ah)

            # Campos
            rows = [
                ["Grupo / Código IRPF", grupo],
                ["Quantidade em 31/12", f"{qtd:,} {'cotas' if is_fii else 'ações'}".replace(",",".")],
                ["Custo de Aquisição", fmt(custo)],
                ["Preço Médio por Unidade", fmt(pm)],
            ]
            ft = Table(
                [[Paragraph(r[0],S_lbl), Paragraph(f"<b>{r[1]}</b>",S_val)] for r in rows],
                colWidths=[5*cm, 12*cm]
            )
            ft.setStyle(TableStyle([
                ('ROWBACKGROUNDS',(0,0),(-1,-1),[LIGHT, colors.HexColor('#ece8e0')]),
                ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),8),
                ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
                ('LINEBELOW',(0,-1),(-1,-1),0.5,colors.HexColor('#cccccc')),
            ]))
            story.append(ft)

            # Texto para copiar na discriminação
            desc = (f"{t} - {'FUNDO DE INVESTIMENTO IMOBILIARIO' if is_fii else 'ACAO'} - "
                    f"{qtd} {'COTAS' if is_fii else 'ACOES'} - "
                    f"PRECO MEDIO: {fmt(pm)} - "
                    f"CUSTO DE AQUISICAO: {fmt(custo)}")
            story.append(Paragraph(
                f"<b>Texto para o campo Discriminação (copie e cole):</b><br/>"
                f"<font color='#1a1a6e' size='9'>{desc}</font>",
                S('dc', fontName='Helvetica', fontSize=8.5, textColor=DARK,
                  backColor=colors.HexColor('#e8e8f8'), borderColor=colors.HexColor('#8888cc'),
                  borderWidth=0.5, borderPad=6, spaceAfter=10, leading=13)
            ))
    else:
        story.append(Paragraph(f"Nenhuma posição em aberto em 31/12/{ano}.", S_body))

    # ── 2. Renda Variável ──────────────────────────────────────
    story.append(Spacer(1,0.4*cm))
    story.append(Paragraph("2. RENDA VARIÁVEL — APURAÇÃO MENSAL", S_h2))
    story.append(HRFlowable(width="100%", thickness=1, color=GOLD, spaceAfter=8))
    story.append(Paragraph(
        "No IRPF acesse <b>Renda Variável → Operações Comuns/Day Trade</b>:<br/>"
        "• Preencha o resultado de cada mês (lucro ou prejuízo).<br/>"
        "• Vendas com lucro onde total no mês ≤ R$20.000: declare em "
        "<b>Rendimentos Isentos — código 20</b>.<br/>"
        "• DARF (código 6015) deve ser pago até o último dia útil do mês seguinte.",
        S_instruc
    ))
    story.append(Spacer(1,0.2*cm))

    if todas_vendas:
        vm = {}
        for v in todas_vendas:
            mes = (v.get('data','') or '')[:7]
            if not mes: continue
            if mes not in vm: vm[mes] = {'lucro':0.0,'total':0.0}
            vm[mes]['total'] += v.get('valor_venda',0)
            vm[mes]['lucro'] += v.get('lucro',0)

        hrow = [Paragraph(f'<b>{h}</b>', S('th2', fontName='Helvetica-Bold', fontSize=8,
                textColor=WHITE)) for h in ['Mês/Ano','Total Vendido','Resultado','Situação','Onde Declarar']]
        tdata = [hrow]
        for mes in sorted(vm.keys()):
            v = vm[mes]; lucro = v['lucro']; total = v['total']
            isento = total <= 20000 and lucro > 0
            mes_fmt = mes[5:7]+'/'+mes[:4]
            lc = '#2d7a4f' if lucro >= 0 else '#8b1a1a'
            ls = f'<font color="{lc}"><b>{("+" if lucro>=0 else "")}{fmt(lucro)}</b></font>'
            if isento:   sit = '<font color="#2d7a4f"><b>ISENTO</b></font>';     onde = 'Rend. Isentos — cód. 20'
            elif lucro>0:sit = '<font color="#8b1a1a"><b>TRIBUTÁVEL</b></font>'; onde = 'Renda Variável + DARF 6015'
            else:        sit = 'Prejuízo';                                        onde = 'Renda Variável (compensar)'
            tdata.append([Paragraph(mes_fmt,S_val), Paragraph(fmt(total),S_val),
                          Paragraph(ls,S_val), Paragraph(sit,S_val), Paragraph(onde,S_val)])

        rv = Table(tdata, colWidths=[2.5*cm,3.5*cm,3*cm,3*cm,5*cm])
        rv.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),DARK),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,LIGHT]),
            ('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#dddddd')),
            ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
            ('LEFTPADDING',(0,0),(-1,-1),6),
        ]))
        story.append(rv)
    else:
        story.append(Paragraph(f"Nenhuma venda registrada em {ano}.", S_body))

    # ── 3. Resumo das Notas ────────────────────────────────────
    if notas_ano:
        story.append(Spacer(1,0.4*cm))
        story.append(Paragraph("3. RESUMO DAS NOTAS IMPORTADAS", S_h2))
        story.append(HRFlowable(width="100%", thickness=1, color=GOLD, spaceAfter=8))
        hrow = [Paragraph(f'<b>{h}</b>', S('nh', fontName='Helvetica-Bold', fontSize=8, textColor=WHITE))
                for h in ['Nota','Data','Ativos','Compras','Vendas','Taxas','Líquido']]
        ndata = [hrow]
        for n in sorted(notas_ano, key=lambda x: x.get('data_pregao','')):
            negs = n.get('negocios_confirmados',[])
            c = sum(x.get('valor_operacao',0) for x in negs if x.get('cv')=='C')
            v = sum(x.get('valor_operacao',0) for x in negs if x.get('cv')=='V')
            tx = sum(n.get('taxas',{}).get(k,0) for k in ['taxa_liquidacao','emolumentos','taxa_transf','taxa_operacional'])
            tks = ', '.join(sorted(set(x.get('ticker','?') for x in negs)))
            ndata.append([Paragraph(n.get('nr_nota',''),S_val), Paragraph(n.get('data_pregao',''),S_val),
                          Paragraph(tks,S_val), Paragraph(fmt(c) if c else '—',S_val),
                          Paragraph(fmt(v) if v else '—',S_val), Paragraph(fmt(tx) if tx else '—',S_val),
                          Paragraph(fmt(n.get('liquido',0)),S_val)])
        nt = Table(ndata, colWidths=[2.5*cm,2.5*cm,4*cm,2.5*cm,2.5*cm,2*cm,2.5*cm])
        nt.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),DARK),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[WHITE,LIGHT]),
            ('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#dddddd')),
            ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),
            ('LEFTPADDING',(0,0),(-1,-1),5),
        ]))
        story.append(nt)

    # ── Rodapé ─────────────────────────────────────────────────
    story += [
        Spacer(1,0.8*cm),
        HRFlowable(width="100%", thickness=0.5, color=GRAY, spaceAfter=6),
        Paragraph(
            f"Gerado pelo Portfex em "
            f"{__import__('datetime').datetime.now().strftime('%d/%m/%Y às %H:%M')} — "
            "Dados baseados nas notas de corretagem importadas.",
            S_foot
        )
    ]

    doc.build(story)
    return buf.getvalue()


# ── TOP 30 IBOVESPA (excluindo ativos já na carteira) ─────────────
IBOV_TOP30 = [
    "PETR4","VALE3","ITUB4","BBDC4","BBAS3","B3SA3","ABEV3","WEGE3",
    "RENT3","SUZB3","LREN3","EQTL3","EMBR3","EGIE3","CPLE6","SAPR4",
    "KLBN11","RADL3","HYPE3","TOTS3","SOMA3","VBBR3","CSAN3","MRVE3",
    "MULT3","SBSP3","CMIG4","TAEE11","VIVT3","NTCO3"
]

# ── Mapa ticker B3 → código CVM (cd_cvm) ─────────────────────────
# Usado para buscar dados na API da CVM
TICKER_CVM = {
    "PETR4":"9512","PETR3":"9512","VALE3":"4170","ITUB4":"19348","ITUB3":"19348",
    "BBDC4":"906","BBDC3":"906","BBAS3":"1023","B3SA3":"23264","ABEV3":"6437",
    "WEGE3":"5410","RENT3":"20656","SUZB3":"21261","LREN3":"12793","EQTL3":"23264",
    "EMBR3":"8370","EGIE3":"21105","CPLE6":"6491","SAPR4":"8028","KLBN11":"12653",
    "RADL3":"22187","HYPE3":"21156","TOTS3":"18074","SOMA3":"24805","VBBR3":"23264",
    "CSAN3":"22608","MRVE3":"23516","MULT3":"18066","SBSP3":"14176","CMIG4":"1432",
    "TAEE11":"23264","VIVT3":"22344","NTCO3":"25925",
    # Carteira Felipe
    "RAPT4":"6653","RANI3":"8370","WIZC3":"23264","EZTC3":"21520","SIMH3":"23264",
    "MXRF11":"23264","JALL3":"23264","DEXP3":"23264","AGRO3":"23264","RECV3":"23264",
    "FESA4":"3743","TUPY3":"22527","UNIP6":"13773","KEPL3":"23264","SHUL4":"23264",
    "CPLE3":"6491","TTEN3":"23264","SMTO3":"16101","SAUD3":"23264",
}

# ── Cache CVM (evita re-download do mesmo ZIP) ─────────────────────
_cvm_cache = {}

def _brapi_url(path, extra_params=""):
    """Monta URL da brapi.dev com token de ambiente se disponível."""
    import os
    token = os.environ.get("BRAPI_TOKEN", "")
    if extra_params and not extra_params.startswith("?"):
        extra_params = "?" + extra_params
    token_part = ("&token=" + token) if token else ""
    return f"https://brapi.dev/api{path}{extra_params}{token_part}"

def fetch_quote(ticker):
    url = _brapi_url(f"/quote/{ticker}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Portfex/1.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}

def _baixar_cvm_itr(ano: int) -> dict:
    """
    Baixa o ZIP do ITR da CVM e extrai os dados de DFC (Fluxo de Caixa),
    DRE (Resultado) e BPP (Balanço) para todos os tickers.
    Retorna dict: {cd_cvm: {receita, ebit, fco, divida_liq, acoes, ...}}
    """
    cache_key = f"itr_{ano}"
    if cache_key in _cvm_cache:
        return _cvm_cache[cache_key]

    import zipfile, io, csv as csv_mod

    result = {}
    urls = [
        f"https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_{ano}.zip",
        f"https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_{ano}.zip",
    ]

    zdata = None
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "*/*", "Referer": "https://dados.cvm.gov.br/",
            })
            with urllib.request.urlopen(req, timeout=45) as resp:
                zdata = resp.read()
            break
        except Exception:
            continue

    if not zdata:
        return {}

    try:
        with zipfile.ZipFile(io.BytesIO(zdata)) as z:
            files = z.namelist()

            # Arquivos relevantes
            # DFC_MD = Demonstração de Fluxo de Caixa (Método Direto ou Indireto)
            # DRE = Demonstração do Resultado
            # BPP = Balanço Patrimonial Passivo (Dívida)
            # FCA = Composição do Capital (número de ações)
            targets = {
                "dfc": [f for f in files if "dfc" in f.lower() and f.endswith(".csv")],
                "dre": [f for f in files if "dre" in f.lower() and f.endswith(".csv")],
                "bpp": [f for f in files if "bpp" in f.lower() and f.endswith(".csv")],
                "capital": [f for f in files if "capital" in f.lower() and f.endswith(".csv")],
            }

            empresa_data = {}  # cd_cvm -> {}

            # ── DFC: Fluxo de Caixa Operacional ──────────────────────
            for fname in targets["dfc"][:2]:
                try:
                    with z.open(fname) as f:
                        reader = csv_mod.DictReader(
                            io.TextIOWrapper(f, encoding='latin-1'), delimiter=';'
                        )
                        for row in reader:
                            cd = row.get("CD_CVM","").strip()
                            ds = row.get("DS_CONTA","").strip().upper()
                            vl = row.get("VL_CONTA","0").replace(".","").replace(",",".")
                            ordem = row.get("ORDEM_EXERC","").strip()
                            if ordem.upper() == "PENÚLTIMO": continue
                            if not cd: continue
                            if cd not in empresa_data: empresa_data[cd] = {}
                            try: vl = float(vl) * 1000  # CVM reporta em milhares
                            except: vl = 0
                            # FCO
                            if any(k in ds for k in ["FLUXO DE CAIXA DAS ATIVIDADES OPERACIONAIS",
                                                       "CAIXA GERADO NAS OPERAÇÕES",
                                                       "DAS ATIVIDADES OPERACIONAIS"]) and "CD_CONTA" in row:
                                cd_conta = row.get("CD_CONTA","")
                                if cd_conta in ("6.01","6.01.00","1.01") or ds.startswith("CAIXA LÍQUIDO"):
                                    if abs(vl) > abs(empresa_data[cd].get("fco",0)):
                                        empresa_data[cd]["fco"] = vl
                except Exception:
                    continue

            # ── DRE: Receita e EBIT ───────────────────────────────────
            for fname in targets["dre"][:2]:
                try:
                    with z.open(fname) as f:
                        reader = csv_mod.DictReader(
                            io.TextIOWrapper(f, encoding='latin-1'), delimiter=';'
                        )
                        for row in reader:
                            cd = row.get("CD_CVM","").strip()
                            ds = row.get("DS_CONTA","").strip().upper()
                            cd_conta = row.get("CD_CONTA","").strip()
                            vl = row.get("VL_CONTA","0").replace(".","").replace(",",".")
                            ordem = row.get("ORDEM_EXERC","").strip()
                            if ordem.upper() == "PENÚLTIMO": continue
                            if not cd: continue
                            if cd not in empresa_data: empresa_data[cd] = {}
                            try: vl = float(vl) * 1000
                            except: vl = 0
                            # Receita Líquida: conta 3.01
                            if cd_conta.startswith("3.01"):
                                if abs(vl) > abs(empresa_data[cd].get("receita",0)):
                                    empresa_data[cd]["receita"] = vl
                            # EBIT: conta 3.05
                            if cd_conta.startswith("3.05"):
                                if abs(vl) > abs(empresa_data[cd].get("ebit",0)):
                                    empresa_data[cd]["ebit"] = vl
                            # Lucro Líquido: conta 3.11
                            if cd_conta.startswith("3.11"):
                                if abs(vl) > abs(empresa_data[cd].get("lucro_liq",0)):
                                    empresa_data[cd]["lucro_liq"] = vl
                except Exception:
                    continue

            # ── BPP: Dívida Bruta ─────────────────────────────────────
            for fname in targets["bpp"][:2]:
                try:
                    with z.open(fname) as f:
                        reader = csv_mod.DictReader(
                            io.TextIOWrapper(f, encoding='latin-1'), delimiter=';'
                        )
                        for row in reader:
                            cd = row.get("CD_CVM","").strip()
                            cd_conta = row.get("CD_CONTA","").strip()
                            vl = row.get("VL_CONTA","0").replace(".","").replace(",",".")
                            ordem = row.get("ORDEM_EXERC","").strip()
                            if ordem.upper() == "PENÚLTIMO": continue
                            if not cd: continue
                            if cd not in empresa_data: empresa_data[cd] = {}
                            try: vl = float(vl) * 1000
                            except: vl = 0
                            # Empréstimos e Financiamentos CP: 2.01.04, LP: 2.02.01
                            if cd_conta in ("2.01.04","2.02.01"):
                                empresa_data[cd]["divida_bruta"] =                                     empresa_data[cd].get("divida_bruta",0) + abs(vl)
                except Exception:
                    continue

        result = empresa_data
    except Exception:
        pass

    _cvm_cache[cache_key] = result
    return result

def _safe_raw(val, default=0):
    """Extrai .raw de dict ou retorna o valor direto."""
    if isinstance(val, dict):
        return val.get("raw", default)
    return val if val is not None else default

def _get_acoes_e_preco(ticker: str) -> dict:
    """
    Busca dados via brapi.dev.
    - Cotação básica: sempre disponível (free tier)
    - Dados financeiros: via módulos (requer token)
    """
    info = {}

    # ── Tenta cotação + módulos financeiros ──────────────────────
    try:
        # Primeiro tenta com módulos (funciona com token)
        url = _brapi_url(
            f"/quote/{ticker}",
            "?modules=summaryProfile,defaultKeyStatistics,financialData"
        )
        req = urllib.request.Request(url, headers={
            "User-Agent": "Portfex/1.0",
            "Accept": "application/json"
        })
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode())

        r = (data.get("results") or [{}])[0]
        price = r.get("regularMarketPrice") or r.get("price", 0)
        if not price:
            return info

        fp = r.get("financialData") or {}
        ks = r.get("defaultKeyStatistics") or {}
        sp = r.get("summaryProfile") or {}

        info["preco_atual"] = float(price)
        info["nome"]        = r.get("longName") or r.get("shortName") or ticker
        info["setor"]       = sp.get("sector", "") if isinstance(sp, dict) else ""
        info["acoes"]       = int(_safe_raw(ks.get("sharesOutstanding"), 0))
        info["dy"]          = round(float(r.get("dividendYield") or 0) * 100, 1)
        info["roe"]         = round(float(_safe_raw(fp.get("returnOnEquity"), 0)) * 100, 1)
        info["pl"]          = round(float(r.get("trailingPE") or _safe_raw(ks.get("trailingEps"), 0)), 1)
        info["pvp"]         = round(float(_safe_raw(ks.get("priceToBook"), 0)), 2)
        info["caixa"]       = float(_safe_raw(fp.get("totalCash"), 0))
        info["fco_yf"]      = float(_safe_raw(fp.get("operatingCashflow"), 0))
        info["capex_yf"]    = float(_safe_raw(fp.get("capitalExpenditures"), 0))
        info["receita_yf"]  = float(_safe_raw(fp.get("totalRevenue"), 0))
        info["ebitda_yf"]   = float(_safe_raw(fp.get("ebitda"), 0))
        info["lucro_yf"]    = float(_safe_raw(fp.get("netIncomeToCommon"), 0))
        info["crescimento"] = abs(float(
            _safe_raw(fp.get("earningsGrowth"), 0) or
            _safe_raw(fp.get("revenueGrowth"), 0) or 0.08
        ))
    except Exception as ex:
        # Se falhou com módulos, tenta cotação simples
        try:
            url2 = _brapi_url(f"/quote/{ticker}")
            req2 = urllib.request.Request(url2, headers={
                "User-Agent": "Portfex/1.0",
                "Accept": "application/json"
            })
            with urllib.request.urlopen(req2, timeout=8) as resp2:
                data2 = json.loads(resp2.read().decode())
            r2 = (data2.get("results") or [{}])[0]
            price2 = r2.get("regularMarketPrice") or r2.get("price", 0)
            if price2:
                info["preco_atual"] = float(price2)
                info["nome"]        = r2.get("longName") or r2.get("shortName") or ticker
                info["dy"]          = round(float(r2.get("dividendYield") or 0) * 100, 1)
                info["crescimento"] = 0.08
        except Exception:
            pass

    return info


def buscar_proventos_carteira(portfolio: list) -> list:
    """
    Busca proventos via brapi.dev para os ativos da carteira.
    """
    proventos = []
    hoje = __import__("datetime").date.today()

    for ativo in portfolio:
        ticker = ativo.get("ticker", "")
        if not ticker: continue
        try:
            url = _brapi_url(f"/quote/{ticker}", "?modules=summaryProfile,defaultKeyStatistics,financialData")
            req = urllib.request.Request(url, headers={"User-Agent": "Portfex/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode())

            r = (data.get("results") or [{}])[0]
            ks = r.get("defaultKeyStatistics", {})
            fp = r.get("financialData", {})

            ex_ts    = ks.get("exDividendDate", {})
            ex_ts    = ex_ts.get("raw", 0) if isinstance(ex_ts, dict) else (ex_ts or 0)
            div_rate = ks.get("dividendRate", {})
            div_rate = div_rate.get("raw", 0) if isinstance(div_rate, dict) else (div_rate or 0)
            dy       = ks.get("dividendYield", {})
            dy       = dy.get("raw", 0) if isinstance(dy, dict) else (dy or 0)

            if ex_ts and div_rate:
                import datetime
                data_ex = datetime.date.fromtimestamp(ex_ts)
                if data_ex >= hoje:
                    tipo = "JCP" if ticker.startswith(("BBAS","ITUB","BBDC","BRAD","SANB")) else "Dividendo"
                    if ticker.endswith("11"): tipo = "Rendimento"
                    val_trimestral = round(div_rate / 4, 4)
                    proventos.append({
                        "ticker": ticker,
                        "valor": val_trimestral,
                        "dataCom": data_ex.strftime("%d/%m/%Y"),
                        "dataPagamento": data_ex.strftime("%d/%m/%Y"),
                        "tipo": tipo,
                        "qtd": ativo.get("qtd", 0),
                        "totalReceber": round(val_trimestral * ativo.get("qtd", 0), 2),
                        "dy12m": round(dy * 100, 2),
                    })
        except Exception:
            continue

    return sorted(proventos, key=lambda x: x.get("dataCom", "9999"))


def get_top30_excluindo_carteira(portfolio: list) -> list:
    tickers_carteira = {a.get("ticker","").upper() for a in portfolio}
    return [t for t in IBOV_TOP30 if t not in tickers_carteira][:30]

def analisar_fcd(ticker: str) -> dict:
    """
    Calcula Preço Justo usando 3 métodos combinados:
    1. FCD (Fluxo de Caixa Descontado) — valor intrínseco
    2. Graham Number — piso conservador (√(22.5 × LPA × VPA))
    3. EV/EBITDA — múltiplo de mercado vs setor
    
    Fontes: CVM (dados financeiros) + brapi.dev (preço, ações, indicadores)
    """
    result = {
        "ticker": ticker, "ok": False, "erro": "",
        "fonte": "", "dados": {}, "fcd": {},
        "graham": {}, "ev_ebitda": {}, "consenso": {}, "parecer": {}
    }

    # ── 1. Tenta dados CVM ────────────────────────────────────────
    cd_cvm = TICKER_CVM.get(ticker.upper(), "")
    cvm_data = {}
    ano_atual = __import__("datetime").datetime.now().year

    for ano in [ano_atual, ano_atual-1]:
        dados_ano = _baixar_cvm_itr(ano)
        if cd_cvm and cd_cvm in dados_ano:
            cvm_data = dados_ano[cd_cvm]
            result["fonte"] = f"CVM ITR {ano}"
            break

    # ── 2. Busca brapi.dev ────────────────────────────────────────
    yf_data = _get_acoes_e_preco(ticker)

    if not yf_data.get("preco_atual") and not cvm_data:
        result["erro"] = f"Sem dados para {ticker}."
        return result

    # ── 3. Mescla dados ───────────────────────────────────────────
    preco_atual  = yf_data.get("preco_atual", 0)
    acoes        = yf_data.get("acoes", 0)
    nome         = yf_data.get("nome", ticker)
    setor        = yf_data.get("setor", "")
    caixa        = yf_data.get("caixa", 0)
    crescimento  = yf_data.get("crescimento", 0.08)

    fco          = cvm_data.get("fco")      or yf_data.get("fco_yf", 0)
    receita      = cvm_data.get("receita")  or yf_data.get("receita_yf", 0)
    ebit         = cvm_data.get("ebit")     or yf_data.get("ebitda_yf", 0)
    lucro        = cvm_data.get("lucro_liq")or yf_data.get("lucro_yf", 0)
    ebitda       = yf_data.get("ebitda_yf", 0) or ebit
    divida_bruta = cvm_data.get("divida_bruta", 0)
    divida_liq   = divida_bruta - caixa
    capex        = yf_data.get("capex_yf", 0)
    fcl          = fco + capex if capex else fco
    fonte_fin    = "CVM" if cvm_data else "Yahoo Finance"

    # LPA e VPA para Graham
    lpa = lucro / acoes if acoes > 0 and lucro > 0 else 0
    vpa = yf_data.get("pvp", 0)
    vpa_real = (preco_atual / vpa) if vpa and vpa > 0 else 0  # Valor Patrimonial por Ação

    # ════════════════════════════════════════════════════════════
    # MÉTODO 1: FCD (Fluxo de Caixa Descontado)
    # ════════════════════════════════════════════════════════════
    WACC          = 0.12
    G_TERMINAL    = 0.06
    ANOS          = 10
    g_cresc       = max(0.03, min(0.20, crescimento))

    fc_base = fcl if fcl and fcl > 0 else (fco if fco and fco > 0 else lucro)
    fluxos = []
    vp_fluxos = 0
    preco_fcd = 0

    if fc_base and fc_base > 0 and acoes > 0:
        fc = fc_base
        for ano in range(1, ANOS+1):
            g = g_cresc - (g_cresc - G_TERMINAL) * (ano / ANOS)
            fc = fc * (1 + g)
            vp = fc / ((1 + WACC) ** ano)
            fluxos.append({"ano": ano, "fc": round(fc), "g": round(g*100,1), "vp": round(vp)})
            vp_fluxos += vp

        fc_terminal    = fc * (1 + G_TERMINAL)
        valor_terminal = fc_terminal / (WACC - G_TERMINAL)
        vp_terminal    = valor_terminal / ((1 + WACC) ** ANOS)
        valor_empresa  = vp_fluxos + vp_terminal
        valor_equity   = valor_empresa - divida_liq
        preco_fcd      = max(0, valor_equity / acoes)
    else:
        vp_terminal = valor_terminal = valor_empresa = valor_equity = 0

    result["fcd"] = {
        "preco_justo": round(preco_fcd, 2),
        "fc_base": round(fc_base) if fc_base else 0,
        "wacc": WACC*100, "g_crescimento": round(g_cresc*100,1),
        "g_terminal": G_TERMINAL*100, "anos": ANOS,
        "vp_fluxos": round(vp_fluxos), "vp_terminal": round(vp_terminal if vp_terminal else 0),
        "valor_empresa": round(valor_empresa if valor_empresa else 0),
        "divida_liquida": round(divida_liq),
        "valor_equity": round(valor_equity if valor_equity else 0),
        "fluxos": fluxos,
        "fonte": fonte_fin,
        "valido": preco_fcd > 0,
        "motivo_invalido": "" if preco_fcd > 0 else ("FCL/FCO negativos" if fc_base and fc_base <= 0 else "Dados insuficientes"),
    }

    # ════════════════════════════════════════════════════════════
    # MÉTODO 2: Graham Number
    # √(22.5 × LPA × VPA)
    # ════════════════════════════════════════════════════════════
    preco_graham = 0
    graham_valido = lpa > 0 and vpa_real > 0

    if graham_valido:
        preco_graham = (22.5 * lpa * vpa_real) ** 0.5

    result["graham"] = {
        "preco_justo": round(preco_graham, 2),
        "lpa": round(lpa, 4),
        "vpa": round(vpa_real, 4),
        "formula": "√(22.5 × LPA × VPA)",
        "valido": graham_valido,
        "motivo_invalido": "" if graham_valido else ("LPA negativo — empresa com prejuízo" if lpa <= 0 else "Valor patrimonial indisponível"),
    }

    # ════════════════════════════════════════════════════════════
    # MÉTODO 3: EV/EBITDA — múltiplo médio do setor
    # ════════════════════════════════════════════════════════════
    # Múltiplos médios por setor (referência Brasil, histórico B3)
    MULTIPLOS_SETOR = {
        "Energy": 5.0, "Basic Materials": 5.5, "Financial Services": 8.0,
        "Utilities": 7.0, "Consumer Defensive": 9.0, "Healthcare": 11.0,
        "Industrials": 9.0, "Technology": 14.0, "Real Estate": 14.0,
        "Consumer Cyclical": 8.0, "Communication Services": 10.0,
    }
    multiplo_setor = MULTIPLOS_SETOR.get(setor, 8.5)  # default 8.5x
    ev_ebitda_valido = ebitda > 0 and acoes > 0

    if ev_ebitda_valido:
        ev_justo     = ebitda * multiplo_setor
        equity_justo = ev_justo - divida_liq
        preco_ev     = max(0, equity_justo / acoes)
    else:
        preco_ev = 0

    result["ev_ebitda"] = {
        "preco_justo": round(preco_ev, 2),
        "ebitda": ebitda,
        "multiplo_setor": multiplo_setor,
        "setor_ref": setor or "Geral",
        "ev_justo": round(ev_justo if ev_ebitda_valido else 0),
        "valido": ev_ebitda_valido and preco_ev > 0,
        "motivo_invalido": "" if ev_ebitda_valido else "EBITDA negativo ou indisponível",
    }

    # ════════════════════════════════════════════════════════════
    # CONSENSO: faixa de preço justo e parecer integrado
    # ════════════════════════════════════════════════════════════
    precos_validos = [p for p in [preco_fcd, preco_graham, preco_ev] if p > 0]
    metodos_validos = sum([preco_fcd > 0, graham_valido and preco_graham > 0, ev_ebitda_valido and preco_ev > 0])

    if precos_validos:
        preco_min  = min(precos_validos)
        preco_max  = max(precos_validos)
        preco_medio = sum(precos_validos) / len(precos_validos)
        # Desconto usando preço médio como referência
        desconto   = ((preco_medio - preco_atual) / preco_medio * 100) if preco_atual > 0 else 0
        dentro_faixa = preco_min <= preco_atual <= preco_max
    else:
        preco_min = preco_max = preco_medio = desconto = 0
        dentro_faixa = False

    # Parecer
    if metodos_validos == 0:
        parecer_txt, parecer_cor = "⚠ Dados insuficientes para calcular preço justo.", "gold"
    elif dentro_faixa:
        parecer_txt, parecer_cor = f"⚖ PREÇO JUSTO — Dentro da faixa estimada ({metodos_validos} método(s))", "gold"
    elif desconto >= 25:
        parecer_txt, parecer_cor = f"✅ SUBAVALIADO — {desconto:.1f}% abaixo da média dos métodos ({metodos_validos} método(s))", "green"
    elif desconto >= 10:
        parecer_txt, parecer_cor = f"🔎 LEVEMENTE SUBAVALIADO — {desconto:.1f}% de desconto ({metodos_validos} método(s))", "gold"
    elif desconto >= -10:
        parecer_txt, parecer_cor = f"⚖ NEUTRO — {desconto:.1f}% do preço médio estimado", "text2"
    else:
        parecer_txt, parecer_cor = f"⛔ SOBREAVALIADO — {abs(desconto):.1f}% acima da média estimada", "red"

    result["consenso"] = {
        "preco_min": round(preco_min, 2),
        "preco_max": round(preco_max, 2),
        "preco_medio": round(preco_medio, 2),
        "desconto": round(desconto, 1),
        "metodos_validos": metodos_validos,
        "dentro_faixa": dentro_faixa,
    }

    margem_ebit = round((ebit/receita)*100, 1) if receita else 0

    result.update({
        "ok": True,
        "fonte": f"{fonte_fin} + Yahoo Finance",
        "dados": {
            "nome": nome, "setor": setor,
            "preco_atual": round(preco_atual, 2),
            "acoes": acoes,
            "market_cap": round(preco_atual * acoes) if acoes else 0,
            "receita": receita, "ebit": ebit, "ebitda": ebitda,
            "lucro_liquido": lucro, "fco": fco, "capex": capex, "fcl": fcl,
            "divida_liquida": round(divida_liq),
            "lpa": round(lpa, 2), "vpa": round(vpa_real, 2),
            "margem_ebit": margem_ebit,
            "roe": yf_data.get("roe", 0),
            "dy": yf_data.get("dy", 0),
            "pl": yf_data.get("pl", 0),
            "pvp": yf_data.get("pvp", 0),
        },
        "parecer": {
            "texto": parecer_txt,
            "cor": parecer_cor,
            "desconto": round(desconto, 1),
        }
    })
    return result

def _processar_negocios(posicoes, payload, portfolio=None):
    """
    Calcula posições por ticker/ano. Na primeira vez que um ticker
    aparece num ano, a posição é SEMEADA com o que já está cadastrado
    em 'Meus Ativos' (quantidade e PM atuais) — depois disso, as
    compras/vendas das notas vão ajustando qtd e PM ponderado.
    """
    for neg in payload.get("negocios_confirmados", []):
        ticker = neg.get("ticker","")
        ano = payload.get("data_pregao","")[-4:]
        if not ticker or not ano: continue
        key = f"{ticker}_{ano}"
        if key not in posicoes:
            ativo = next((a for a in (portfolio or []) if a.get("ticker")==ticker), None)
            if ativo and ativo.get("qtd",0) > 0:
                qtd0=ativo["qtd"]; pm0=ativo.get("preco",0)
                posicoes[key]={"ticker":ticker,"ano":ano,"qtd":qtd0,
                               "custo_total":round(qtd0*pm0,2),"pm":pm0,"vendas":[]}
            else:
                posicoes[key]={"ticker":ticker,"ano":ano,"qtd":0,"custo_total":0.0,"pm":0.0,"vendas":[]}
        pos = posicoes[key]
        if neg["cv"]=="C":
            pos["custo_total"]=round(pos["custo_total"]+neg["custo_total"],2)
            pos["qtd"]+=neg["qtd"]
            pos["pm"]=round(pos["custo_total"]/pos["qtd"],4) if pos["qtd"] else 0
        elif neg["cv"]=="V":
            custo=round(pos["pm"]*neg["qtd"],2)
            lucro=round(neg["valor_operacao"]-custo-neg.get("taxas_prop",0),2)
            pos["custo_total"]=round(pos["custo_total"]-custo,2)
            pos["qtd"]=max(0,pos["qtd"]-neg["qtd"])
            pos["pm"]=round(pos["custo_total"]/pos["qtd"],4) if pos["qtd"] else 0
            pos["vendas"].append({"data":payload.get("data_pregao"),"qtd":neg["qtd"],"preco_venda":neg["preco"],"valor_venda":neg["valor_operacao"],"custo":custo,"lucro":lucro,"day_trade":neg.get("day_trade",False)})

def _recalcular_ano(ir_data, portfolio, ano):
    """Remove e recalcula todas as posições de um ano a partir do zero."""
    ir_data["posicoes"] = {k:v for k,v in ir_data["posicoes"].items() if not k.endswith(f"_{ano}")}
    for n in ir_data["notas"]:
        if n.get("data_pregao","")[-4:] == ano:
            _processar_negocios(ir_data["posicoes"], n, portfolio)
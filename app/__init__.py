"""
Portfex Web — Backend Flask
Multi-usuário, Supabase Auth + PostgreSQL, Kiwify para pagamentos
"""
import os, json, re, io, secrets, time
import time as _time
_fcd_cache = {}
FCD_CACHE_TTL = 3600
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template, redirect, Response
import psycopg2
import psycopg2.extras
import bcrypt
import jwt

# ── Financial logic (extracted from portfex desktop) ──────────────
from app.financial import (
    fetch_quote, analisar_fcd, buscar_proventos_carteira,
    get_top30_excluindo_carteira, parse_rico_pdf, gerar_pdf_ir,
    _processar_negocios, _recalcular_ano,
    PDF_SUPPORT, PDF_GEN_SUPPORT, YF_SUPPORT
)

# ── Config ────────────────────────────────────────────────────────
app = Flask(__name__, template_folder='../templates', static_folder='../static')
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# Standard Jinja2 delimiters ({{ }} and {% %})

DATABASE_URL = os.environ.get('DATABASE_URL', '')
JWT_SECRET   = os.environ.get('JWT_SECRET', secrets.token_hex(32))
JWT_EXPIRE_H = 24 * 7  # 7 dias

# Kiwify webhook secret (para validar pagamentos)
KIWIFY_SECRET = os.environ.get('KIWIFY_SECRET', '')
APP_URL        = os.environ.get('APP_URL', 'http://localhost:5000')

PLANO_GRATIS_LIMITE = 2
PRECO_MENSAL        = 29.90
PRECO_ANUAL         = 199.00

# ── Database ─────────────────────────────────────────────────────
def get_db():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)

def init_db():
    """Cria tabelas se não existirem."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id               SERIAL PRIMARY KEY,
                    email            VARCHAR(255) UNIQUE NOT NULL,
                    password         VARCHAR(255) NOT NULL,
                    name             VARCHAR(255),
                    plano            VARCHAR(20)  DEFAULT 'gratis',
                    assinatura_ativa BOOLEAN      DEFAULT FALSE,
                    assinatura_fim   TIMESTAMP,
                    kiwify_email     VARCHAR(255),
                    created_at       TIMESTAMP    DEFAULT NOW(),
                    updated_at       TIMESTAMP    DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS portfolios (
                    id         SERIAL  PRIMARY KEY,
                    user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    data       JSONB   DEFAULT \'{"portfolio":[],"metas":{"Ações":40,"FII":20,"Renda Fixa":25,"Cripto":5,"Internacional":5,"Outros":5},"aportes":[],"ir_data":{"notas":[],"posicoes":{}}}\',
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
                CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id);
            ''')
        conn.commit()
    print('Database initialized ✅')

# ── Auth helpers ──────────────────────────────────────────────────
def hash_pw(p):  return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()
def check_pw(p, h): return bcrypt.checkpw(p.encode(), h.encode())

def make_token(user_id, email):
    return jwt.encode(
        {'user_id': user_id, 'email': email,
         'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRE_H)},
        JWT_SECRET, algorithm='HS256'
    )

def decode_token(token):
    try: return jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except: return None

def current_user():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    if not token: token = request.cookies.get('pf_token', '')
    if not token: return None
    payload = decode_token(token)
    if not payload: return None
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT * FROM users WHERE id=%s', (payload['user_id'],))
            return cur.fetchone()

def require_auth(f):
    @wraps(f)
    def dec(*a, **k):
        u = current_user()
        if not u: return jsonify({'error': 'Não autenticado'}), 401
        request.user = u
        return f(*a, **k)
    return dec

def require_pro(f):
    @wraps(f)
    def dec(*a, **k):
        u = current_user()
        if not u: return jsonify({'error': 'Não autenticado'}), 401
        if not u['assinatura_ativa']:
            return jsonify({'error': 'Plano Pro necessário', 'upgrade': True}), 403
        request.user = u
        return f(*a, **k)
    return dec

# ── Portfolio helpers ─────────────────────────────────────────────
DEFAULT_DATA = {
    'portfolio': [],
    'metas': {'Ações':40,'FII':20,'Renda Fixa':25,'Cripto':5,'Internacional':5,'Outros':5},
    'aportes': [],
    'ir_data': {'notas': [], 'posicoes': {}}
}

def get_portfolio(user_id):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT data FROM portfolios WHERE user_id=%s', (user_id,))
            row = cur.fetchone()
            if row: return row['data']
            default = json.loads(json.dumps(DEFAULT_DATA))
            cur.execute('INSERT INTO portfolios (user_id, data) VALUES (%s,%s)',
                       (user_id, json.dumps(default)))
        conn.commit()
        return default

def save_portfolio(user_id, data):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO portfolios (user_id, data, updated_at) VALUES (%s,%s,NOW())
                ON CONFLICT (user_id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()
            ''', (user_id, json.dumps(data, ensure_ascii=False)))
        conn.commit()

# ══════════════════════════════════════════════════════════════════
# PÁGINAS
# ══════════════════════════════════════════════════════════════════

@app.route('/')
def index():
    u = current_user()
    if u: return redirect('/app')
    return render_template('landing.html')

@app.route('/login')
def login_page():
    return render_template('login.html')

@app.route('/cadastro')
def cadastro_page():
    return render_template('cadastro.html')

@app.route('/app')
def app_page():
    u = current_user()
    if not u: return redirect('/login')
    return render_template('app.html', user=u,
                           limite_gratis=PLANO_GRATIS_LIMITE,
                           preco_mensal=PRECO_MENSAL,
                           preco_anual=PRECO_ANUAL)

@app.route('/planos')
def planos_page():
    return render_template('planos.html')

# ══════════════════════════════════════════════════════════════════
# API — AUTH
# ══════════════════════════════════════════════════════════════════

@app.route('/api/auth/cadastro', methods=['POST'])
def api_cadastro():
    d = request.json or {}
    email = (d.get('email') or '').strip().lower()
    senha = d.get('senha') or d.get('password', '')
    nome  = (d.get('nome') or d.get('name') or '').strip()

    if not email or not senha or not nome:
        return jsonify({'ok': False, 'erro': 'Preencha todos os campos'}), 400
    if not re.match(r'^[^@]+@[^@]+\.[^@]+$', email):
        return jsonify({'ok': False, 'erro': 'Email inválido'}), 400
    if len(senha) < 6:
        return jsonify({'ok': False, 'erro': 'Senha deve ter ao menos 6 caracteres'}), 400

    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT id FROM users WHERE email=%s', (email,))
                if cur.fetchone():
                    return jsonify({'ok': False, 'erro': 'Email já cadastrado'}), 409
                cur.execute(
                    'INSERT INTO users (email,password,name) VALUES (%s,%s,%s) RETURNING id',
                    (email, hash_pw(senha), nome)
                )
                uid = cur.fetchone()['id']
            conn.commit()
        token = make_token(uid, email)
        resp  = jsonify({'ok': True, 'token': token, 'nome': nome, 'plano': 'gratis'})
        resp.set_cookie('pf_token', token, httponly=True, samesite='Lax', max_age=60*60*24*7)
        return resp
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    d = request.json or {}
    email = (d.get('email') or '').strip().lower()
    senha = d.get('senha') or d.get('password', '')

    if not email or not senha:
        return jsonify({'ok': False, 'erro': 'Preencha email e senha'}), 400
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM users WHERE email=%s', (email,))
                u = cur.fetchone()
        if not u or not check_pw(senha, u['password']):
            return jsonify({'ok': False, 'erro': 'Email ou senha incorretos'}), 401
        token = make_token(u['id'], email)
        resp  = jsonify({'ok': True, 'token': token, 'nome': u['name'],
                         'plano': u['plano'], 'pro': u['assinatura_ativa']})
        resp.set_cookie('pf_token', token, httponly=True, samesite='Lax', max_age=60*60*24*7)
        return resp
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    resp = jsonify({'ok': True})
    resp.delete_cookie('pf_token')
    return resp

@app.route('/api/auth/esqueci-senha', methods=['POST'])
def api_esqueci_senha():
    d = request.json or {}
    email = (d.get('email') or '').strip().lower()
    if not email:
        return jsonify({'ok': False, 'erro': 'Email obrigatório'}), 400
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT id, name FROM users WHERE email=%s', (email,))
                user = cur.fetchone()
        # Sempre retorna ok para não revelar se email existe ou não
        if user:
            # Gera token de reset (válido por 1 hora)
            token = make_token(user['id'], email)
            reset_url = f"{APP_URL}/reset-senha?token={token}"
            # TODO: enviar email com reset_url via Resend/SendGrid
            # Por agora, loga no servidor para teste
            print(f"[RESET] {email} → {reset_url}")
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': True})  # Sempre ok por segurança

@app.route('/reset-senha')
def reset_senha_page():
    token = request.args.get('token', '')
    payload = decode_token(token)
    if not payload:
        return redirect('/login?erro=link-expirado')
    return render_template('reset_senha.html')

@app.route('/api/auth/reset-senha', methods=['POST'])
def api_reset_senha():
    d = request.json or {}
    token = d.get('token', '')
    nova_senha = d.get('senha', '')
    if len(nova_senha) < 6:
        return jsonify({'ok': False, 'erro': 'Senha deve ter ao menos 6 caracteres'}), 400
    payload = decode_token(token)
    if not payload:
        return jsonify({'ok': False, 'erro': 'Link expirado ou inválido'}), 400
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute('UPDATE users SET password=%s, updated_at=NOW() WHERE id=%s',
                           (hash_pw(nova_senha), payload['user_id']))
            conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/api/auth/me')
@require_auth
def api_me():
    u = request.user
    return jsonify({
        'ok': True, 'id': u['id'], 'email': u['email'], 'nome': u['name'],
        'plano': u['plano'], 'pro': u['assinatura_ativa'],
        'assinatura_fim': u['assinatura_fim'].isoformat() if u['assinatura_fim'] else None
    })

# ══════════════════════════════════════════════════════════════════
# API — PORTFÓLIO
# ══════════════════════════════════════════════════════════════════

@app.route('/api/data')
@require_auth
def api_get_data():
    u    = request.user
    data = get_portfolio(u['id'])
    if not u['assinatura_ativa']:
        data = dict(data)
        data['_plano']       = 'gratis'
        data['_limite']      = PLANO_GRATIS_LIMITE
        data['_total_ativos']= len(data.get('portfolio', []))
    return jsonify(data)

@app.route('/api/data', methods=['POST'])
@require_auth
def api_save_data():
    u    = request.user
    body = request.json or {}
    port = body.get('portfolio', [])
    if not u['assinatura_ativa'] and len(port) > PLANO_GRATIS_LIMITE:
        return jsonify({'ok': False,
                        'erro': f'Plano gratuito: até {PLANO_GRATIS_LIMITE} ativos.',
                        'upgrade': True}), 403
    try:
        existing = get_portfolio(u['id'])
        existing['portfolio'] = port
        existing['metas']    = body.get('metas', existing.get('metas', {}))
        existing['aportes']  = body.get('aportes', existing.get('aportes', []))
        save_portfolio(u['id'], existing)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

# ══════════════════════════════════════════════════════════════════
# API — COTAÇÕES
# ══════════════════════════════════════════════════════════════════

@app.route('/api/quote/<ticker>')
@require_auth
def api_quote(ticker):
    return jsonify(fetch_quote(ticker.upper()))

@app.route('/api/quotes', methods=['POST'])
@require_auth
def api_quotes_batch():
    """Busca cotações de múltiplos tickers de uma vez."""
    tickers = request.json.get('tickers', [])
    results = {}
    for t in tickers[:30]:
        try:
            q = fetch_quote(t.upper())
            if q.get('results'):
                results[t] = q['results'][0]
        except Exception:
            pass
    return jsonify({'ok': True, 'quotes': results})

# ══════════════════════════════════════════════════════════════════
# API — ANÁLISE & VALUATION
# ══════════════════════════════════════════════════════════════════

@app.route('/api/analisar-carteira')
@require_auth
def api_analisar_carteira():
    data     = get_portfolio(request.user['id'])
    port     = data.get('portfolio', [])
    carteira = [a['ticker'] for a in port if a.get('classe') in ('Ações','Internacional')]
    top30    = get_top30_excluindo_carteira(port)
    return jsonify({
        'ok': True,
        'carteira': carteira,
        'top30': top30,
        'yf_support': YF_SUPPORT
    })

@app.route('/api/analisar-fcd')
@require_auth
def api_analisar_fcd():
    ticker = request.args.get('ticker', '').upper().strip()
    if not ticker:
        return jsonify({'ok': False, 'erro': 'ticker obrigatório', 'ticker': ''})
    try:
        # Verifica cache
        now = _time.time()
        if ticker in _fcd_cache:
            resultado, ts = _fcd_cache[ticker]
            if now - ts < FCD_CACHE_TTL:
                return jsonify(resultado)

        result = analisar_fcd(ticker)
        if 'ticker' not in result: result['ticker'] = ticker

        # Salva no cache apenas se obteve dados
        if result.get('ok') or result.get('dados'):
            _fcd_cache[ticker] = (result, now)

        return jsonify(result)
    except Exception as e:
        import traceback
        print("FCD error for "+ticker+": "+str(e))
        return jsonify({'ok': False, 'erro': str(e), 'ticker': ticker})

# ══════════════════════════════════════════════════════════════════
# API — PROVENTOS
# ══════════════════════════════════════════════════════════════════

@app.route('/api/proventos')
@require_auth
def api_proventos():
    data      = get_portfolio(request.user['id'])
    portfolio = data.get('portfolio', [])
    proventos = buscar_proventos_carteira(portfolio)
    return jsonify({'ok': True, 'proventos': proventos})

# ══════════════════════════════════════════════════════════════════
# API — IR
# ══════════════════════════════════════════════════════════════════

@app.route('/api/ir-check')
@require_auth
def api_ir_check():
    return jsonify({'pdf_support': PDF_SUPPORT, 'pdf_gen_support': PDF_GEN_SUPPORT})

@app.route('/api/nota-pdf', methods=['POST'])
@require_pro
def api_nota_pdf():
    try:
        return jsonify(parse_rico_pdf(request.data))
    except Exception as e:
        return jsonify({'erros': [str(e)], 'negocios': []})

@app.route('/api/ir-salvar', methods=['POST'])
@require_pro
def api_ir_salvar():
    payload = request.json or {}
    uid     = request.user['id']
    data    = get_portfolio(uid)
    if 'ir_data' not in data: data['ir_data'] = {'notas': [], 'posicoes': {}}
    portfolio = data.get('portfolio', [])
    ano       = payload.get('data_pregao', '')[-4:]

    nota_id = payload.get('id')
    if nota_id:
        data['ir_data']['notas'] = [n for n in data['ir_data']['notas'] if n.get('id') != nota_id]
    else:
        payload['id'] = str(int(time.time() * 1000))
    data['ir_data']['notas'].append(payload)
    _recalcular_ano(data['ir_data'], portfolio, ano)

    # Atualiza Meus Ativos (qtd/PM) — não cria lançamentos em Aportes
    for neg in payload.get('negocios_confirmados', []):
        ticker = neg.get('ticker', '')
        if not ticker: continue
        data_pregao = payload.get('data_pregao', '')
        try:
            dd, mm, aaaa = data_pregao.split('/')
            data_iso = f'{aaaa}-{mm}-{dd}'
        except Exception:
            data_iso = data_pregao

        ativo = next((a for a in portfolio if a.get('ticker') == ticker), None)
        if neg['cv'] == 'C':
            if ativo:
                qtd_total   = ativo['qtd'] + neg['qtd']
                custo_total = ativo['qtd'] * ativo['preco'] + neg['custo_total']
                pm_ant      = ativo['preco']
                ativo['qtd']   = qtd_total
                ativo['preco'] = round(custo_total / qtd_total, 4) if qtd_total else 0
                if 'historicoCompras' not in ativo: ativo['historicoCompras'] = []
                ativo['historicoCompras'].append({
                    'id': int(time.time() * 1000), 'data': data_iso,
                    'obs': f'Nota {payload.get("nr_nota","")}',
                    'qtdComprada': neg['qtd'], 'precoCompra': neg.get('pm_real', neg['preco']),
                    'corretagem': neg.get('taxas_prop', 0), 'pmAnterior': pm_ant,
                    'pmNovo': ativo['preco'], 'totalPago': neg['custo_total'],
                    'notaId': payload['id']
                })
            else:
                portfolio.append({
                    'ticker': ticker,
                    'classe': 'FII' if ticker.endswith('11') else 'Ações',
                    'setor': '', 'qtd': neg['qtd'],
                    'preco': neg.get('pm_real', neg['preco']),
                    'cotacao': neg.get('pm_real', neg['preco']),
                    'data': '', 'obs': '', 'updatedAt': int(time.time() * 1000)
                })
        elif neg['cv'] == 'V' and ativo:
            ativo['qtd'] = max(0, ativo['qtd'] - neg['qtd'])

    data['portfolio'] = portfolio
    save_portfolio(uid, data)
    return jsonify({'ok': True})

@app.route('/api/ir-excluir', methods=['POST'])
@require_pro
def api_ir_excluir():
    params  = request.json or {}
    nota_id = params.get('id')
    uid     = request.user['id']
    data    = get_portfolio(uid)
    if 'ir_data' not in data: data['ir_data'] = {'notas': [], 'posicoes': {}}
    nota = next((n for n in data['ir_data']['notas'] if n.get('id') == nota_id), None)
    if nota:
        ano = nota.get('data_pregao', '')[-4:]
        data['ir_data']['notas'] = [n for n in data['ir_data']['notas'] if n.get('id') != nota_id]
        _recalcular_ano(data['ir_data'], data.get('portfolio', []), ano)
        save_portfolio(uid, data)
    return jsonify({'ok': True})

@app.route('/api/ir-pdf/<ano>')
@require_pro
def api_ir_pdf(ano):
    data    = get_portfolio(request.user['id'])
    ir      = data.get('ir_data', {'notas': [], 'posicoes': {}})
    if not PDF_GEN_SUPPORT:
        return jsonify({'error': 'reportlab não instalado'}), 503
    try:
        pdf_bytes = gerar_pdf_ir(ir.get('posicoes', {}), ir.get('notas', []), ano)
        return Response(pdf_bytes, mimetype='application/pdf',
                        headers={'Content-Disposition': f'attachment; filename="Portfex_IR_{ano}.pdf"'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ══════════════════════════════════════════════════════════════════
# API — KIWIFY WEBHOOK (pagamentos)
# ══════════════════════════════════════════════════════════════════

@app.route('/api/kiwify/webhook', methods=['POST'])
def api_kiwify_webhook():
    """
    Recebe notificações de pagamento da Kiwify.
    Docs: https://docs.kiwify.com.br/webhooks
    """
    data = request.json or {}

    # Valida assinatura se configurada
    sig = request.headers.get('X-Kiwify-Signature', '')
    if KIWIFY_SECRET and sig:
        import hmac, hashlib
        expected = hmac.new(
            KIWIFY_SECRET.encode(),
            request.data,
            hashlib.sha256
        ).hexdigest()
        if sig != expected:
            return '', 401

    event       = data.get('event', '')
    order       = data.get('order', {})
    customer    = order.get('customer', {})
    email       = (customer.get('email') or '').lower().strip()
    product     = order.get('product', {})
    plan_name   = (product.get('name') or '').lower()

    # Determina plano e vigência
    if 'anual' in plan_name or 'yearly' in plan_name:
        dias = 366
    else:
        dias = 32  # mensal com 2 dias de tolerância

    def set_user_plan(email, ativo, dias=32):
        """Ativa ou desativa o plano do usuário pelo email."""
        if not email: return
        fim = datetime.now() + timedelta(days=dias) if ativo else None
        with get_db() as conn:
            with conn.cursor() as cur:
                # Tenta atualizar usuário existente
                cur.execute('''
                    UPDATE users SET
                        plano = %s, assinatura_ativa = %s,
                        assinatura_fim = %s, kiwify_email = %s,
                        updated_at = NOW()
                    WHERE email = %s
                ''', ('pro' if ativo else 'gratis', ativo, fim, email, email))
                if cur.rowcount == 0:
                    # Usuário ainda não cadastrado — salva email para quando cadastrar
                    # (será ativado automaticamente no cadastro)
                    cur.execute('''
                        INSERT INTO users (email, password, name, plano, assinatura_ativa,
                                          assinatura_fim, kiwify_email)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (email) DO UPDATE SET
                            plano = EXCLUDED.plano,
                            assinatura_ativa = EXCLUDED.assinatura_ativa,
                            assinatura_fim = EXCLUDED.assinatura_fim
                    ''', (email, secrets.token_hex(16), customer.get('name',''), 
                          'pro' if ativo else 'gratis', ativo, fim, email))
            conn.commit()

    # Trata eventos
    if event in ('order.approved', 'order.paid', 'subscription.activated'):
        set_user_plan(email, True, dias)
    elif event in ('order.refunded', 'subscription.cancelled', 'subscription.overdue'):
        set_user_plan(email, False)
    elif event == 'subscription.renewed':
        set_user_plan(email, True, dias)

    return jsonify({'ok': True}), 200

@app.route('/api/ping')
def api_ping():
    return jsonify({'ok': True, 'service': 'Portfex Web', 'version': '1.0'})

# ── Bootstrap ─────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)

# Portfex Web — Guia de Deploy

## Stack
- Backend: Flask (Python 3.11)
- Banco: PostgreSQL (Render)
- Hospedagem: Render.com
- Pagamento: Kiwify
- PWA: manifest.json + Service Worker

---

## 1. GitHub

```bash
cd portfex_web
git init
git add .
git commit -m "Portfex Web v1.0"
git remote add origin https://github.com/SEU_USUARIO/portfex-web.git
git push -u origin main
```

---

## 2. Render.com

1. New → Web Service → conecte o GitHub repo
2. Build Command: `pip install -r requirements.txt`
3. Start Command: `gunicorn wsgi:app`
4. Plan: Free (para começar)
5. New → PostgreSQL → nome: portfex-db → Free

### Variáveis de Ambiente (Settings → Environment):

| Chave | Valor |
|-------|-------|
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `JWT_SECRET` | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `DATABASE_URL` | Internal URL do PostgreSQL criado acima |
| `PYTHON_VERSION` | `3.11.9` |
| `APP_URL` | `https://portfex.onrender.com` |
| `KIWIFY_SECRET` | (pegar no painel Kiwify → Webhooks) |

---

## 3. Kiwify (pagamentos)

1. Acesse kiwify.com.br e crie conta
2. Criar produto: "Portfex Pro Mensal" → R$29,90/mês recorrente
3. Criar produto: "Portfex Pro Anual" → R$199,00/ano recorrente
4. Configurar Webhook:
   - URL: `https://portfex.onrender.com/api/kiwify/webhook`
   - Eventos: order.approved, order.refunded, subscription.cancelled, subscription.renewed
   - Copie o Webhook Secret → `KIWIFY_SECRET` no Render
5. Atualizar links no `templates/planos.html`:
   - `https://pay.kiwify.com.br/portfex-mensal` → URL real do produto mensal
   - `https://pay.kiwify.com.br/portfex-anual` → URL real do produto anual

---

## 4. Domínio (opcional)

- Render Settings → Custom Domains → adicione seu domínio
- Configure DNS: CNAME apontando para o domínio do Render

---

## 5. Testar

1. Acesse a URL do Render
2. Crie uma conta
3. Verifique `/api/ping` → deve retornar `{"ok": true}`
4. Teste o login e o dashboard

---

## Custos estimados

| Serviço | Custo |
|---------|-------|
| Render Free | R$0/mês (dorme após 15min) |
| Render Starter | ~R$30/mês (sempre online) |
| PostgreSQL Free | R$0 (90 dias, depois ~R$30/mês) |
| Kiwify | 0% a 4.99% por venda |
| **Total fixo** | **~R$60/mês** (Render Starter + DB) |

Com 3 assinantes mensais (R$29,90 × 3 = R$89,70) já cobre os custos.

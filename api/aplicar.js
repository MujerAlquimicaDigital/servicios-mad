// Aplicaciones de la página de servicios: guarda a la persona en Brevo y avisa a Mimi y Ale por correo.
// Variables de entorno (Vercel): BREVO_API_KEY, BREVO_LIST_ID, NOTIFY_EMAILS (correos separados por coma)
const BREVO = 'https://api.brevo.com/v3';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);

async function brevo(path, body) {
  const r = await fetch(BREVO + path, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

function aviso(d) {
  const fila = (k, v) => `<tr><td style="padding:6px 14px 6px 0;color:#5b6b7e;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:6px 0;color:#263549;">${esc(v || '—')}</td></tr>`;
  return `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#263549;">
<p style="margin:0 0 14px 0;"><strong>Nueva aplicación en la página de servicios</strong></p>
<table cellpadding="0" cellspacing="0">${fila('Nombre', d.nombre)}${fila('Correo', d.email)}${fila('WhatsApp', d.whatsapp)}${fila('Instagram o web', d.instagram)}${fila('Camino', d.camino)}${fila('Facturación mensual', d.facturacion)}${fila('Origen', d.origen)}</table>
<p style="margin:16px 0 4px 0;color:#5b6b7e;">Mayor desafío o bloqueo:</p>
<p style="margin:0;white-space:pre-wrap;">${esc(d.atoron)}</p>
<p style="margin:18px 0 0 0;color:#5b6b7e;">Ya quedó guardada en Brevo (lista de aplicaciones). Pasos: escribirle por WhatsApp para coordinar la sesión de valoración.</p>
</body></html>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  if (b.website) return res.status(200).json({ ok: true }); // honeypot: se descarta en silencio

  const utm = b.utm && typeof b.utm === 'object' ? Object.entries(b.utm).map(([k, v]) => `${clean(k, 20)}=${clean(v, 60)}`).join(' ') : '';
  const d = {
    nombre: clean(b.nombre, 80),
    email: clean(b.email, 160).toLowerCase(),
    whatsapp: clean(b.whatsapp, 40),
    instagram: clean(b.instagram, 160),
    camino: clean(b.camino, 90),
    facturacion: clean(b.facturacion, 60),
    atoron: clean(b.atoron, 1500),
    origen: clean([b.landing_path, utm].filter(Boolean).join(' | '), 300),
  };
  if (!d.nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email) || d.whatsapp.replace(/\D/g, '').length < 7 || !d.camino || !d.facturacion || !d.atoron) {
    return res.status(400).json({ error: 'datos' });
  }

  const c = await brevo('/contacts', {
    email: d.email,
    listIds: [Number(process.env.BREVO_LIST_ID)],
    updateEnabled: true,
    attributes: { NOMBRE: d.nombre, TELEFONO_WA: d.whatsapp, INSTAGRAM: d.instagram, CAMINO: d.camino, FACTURACION: d.facturacion, RETO: d.atoron, ORIGEN: d.origen },
  });
  if (!c.ok) { console.error('Brevo contacto', c.status, c.text); return res.status(502).json({ error: 'contacto' }); }

  // El aviso no bloquea: si falla, la aplicación ya quedó guardada en Brevo.
  const para = String(process.env.NOTIFY_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean).map((email) => ({ email }));
  if (para.length) {
    const m = await brevo('/smtp/email', {
      sender: { name: 'Página de servicios MAD', email: 'info@mujeralquimicadigital.com' },
      to: para,
      replyTo: { email: d.email, name: d.nombre },
      subject: `Nueva aplicación MAD: ${d.nombre} (${d.camino.split(' (')[0]})`,
      htmlContent: aviso(d),
    });
    if (!m.ok) console.error('Brevo aviso', m.status, m.text);
  } else {
    console.error('NOTIFY_EMAILS vacío: no se envió aviso');
  }
  return res.status(200).json({ ok: true });
};

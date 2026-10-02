import session from 'express-session';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, check } from '../errors.js';
import { FileSessionStore } from './session-store.js';

const digest = value => createHash('sha256').update(String(value || '')).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
export async function installAuth(app, config, log) {
  const store = await new FileSessionStore(config).init();
  app.use('/api/admin', session({ name: 'easydesk.sid', secret: config.admin.sessionSecret, store, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'strict', secure: 'auto', maxAge: config.admin.sessionHours * 3600000 } }));
  app.use('/api/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin')) {
      try { if (new URL(req.get('origin')).host !== req.get('host')) throw new Error(); }
      catch { return next(new ApiError(403, 'ORIGIN_REJECTED', '请求来源无效')); }
    }
    next();
  });
  const attempts = new Map();
  app.post('/api/admin/login', async (req, res) => {
    const now = Date.now();
    for (const [ip, attempt] of attempts) if (attempt.until < now) attempts.delete(ip);
    const attempt = attempts.get(req.ip) || { count: 0, until: now + 900000 };
    if (attempt.count >= 10) throw new ApiError(429, 'LOGIN_RATE_LIMIT', '登录尝试过多，请稍后再试');
    check(typeof req.body?.username === 'string' && typeof req.body?.password === 'string', '请输入用户名和密码');
    if (!equal(req.body.username, config.admin.username) || !equal(req.body.password, config.admin.password)) {
      attempt.count++; attempts.set(req.ip, attempt); log.warn('admin_login_failed'); throw new ApiError(401, 'LOGIN_FAILED', '用户名或密码错误');
    }
    attempts.delete(req.ip);
    await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.user = config.admin.username; req.session.csrf = randomBytes(24).toString('hex');
    await new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
    log.info('admin_login'); res.json({ ok: true, data: { username: req.session.user, csrfToken: req.session.csrf } });
  });
  app.use('/api/admin', (req, res, next) => {
    if (!req.session?.user) return next(new ApiError(401, 'AUTH_REQUIRED', '请先登录'));
    if (!['GET', 'HEAD'].includes(req.method) && !equal(req.get('x-csrf-token'), req.session.csrf)) return next(new ApiError(403, 'CSRF_REJECTED', '会话校验失败，请重新登录'));
    next();
  });
  app.get('/api/admin/session', (req, res) => res.json({ ok: true, data: { username: req.session.user, csrfToken: req.session.csrf } }));
  app.post('/api/admin/logout', async (req, res) => { await new Promise((resolve, reject) => req.session.destroy(e => e ? reject(e) : resolve())); res.clearCookie('easydesk.sid'); res.json({ ok: true, data: null }); });
}

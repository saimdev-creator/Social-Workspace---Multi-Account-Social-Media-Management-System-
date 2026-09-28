const platforms = {
  facebook: { name: 'Facebook', url: 'https://www.facebook.com/', color: '#1877f2', glyph: 'f' },
  instagram: { name: 'Instagram', url: 'https://www.instagram.com/', color: '#d94682', glyph: '◎' },
  threads: { name: 'Threads', url: 'https://www.threads.com/', color: '#374151', glyph: '@' },
  x: { name: 'X', url: 'https://x.com/', color: '#111827', glyph: '𝕏' },
  linkedin: { name: 'LinkedIn', url: 'https://www.linkedin.com/', color: '#0a66c2', glyph: 'in' },
  whatsapp: { name: 'WhatsApp', url: 'https://web.whatsapp.com/', color: '#128c7e', glyph: '◔' },
  pinterest: { name: 'Pinterest', url: 'https://www.pinterest.com/', color: '#bd081c', glyph: 'P' },
  gmail: { name: 'Gmail', url: 'https://mail.google.com/', color: '#ea4335', glyph: 'M' },
  reddit: { name: 'Reddit', url: 'https://www.reddit.com/', color: '#ff4500', glyph: '●' },
  discord: { name: 'Discord', url: 'https://discord.com/app', color: '#5865f2', glyph: '◌' }
};

function getPlatform(id) {
  return platforms[id] || null;
}

module.exports = { platforms, getPlatform };

const postsToLoad = [
  "post/what-is-text2.md",
  "post/building-ai-offline.md",
  "post/chat-ai-humans.md",
  "post/text2-developer-api.md"
  // ... thêm nếu cần
];

async function loadLatestPosts() {
  const posts = await Promise.all(postsToLoad.map(async (url) => {
    const res = await fetch(url);
    const raw = await res.text();

    const frontmatterMatch = raw.match(/---([\s\S]*?)---/);
    if (!frontmatterMatch) return null;

    const metadata = {};
    frontmatterMatch[1].trim().split('\n').forEach(line => {
      const [key, ...value] = line.split(':');
      metadata[key.trim()] = value.join(':').trim().replace(/^"|"$/g, '');
    });

    return {
      ...metadata,
      link: url.replace('.md', '.html')
    };
  }));

  const latestPosts = posts
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 2); // Lấy 2 bài mới nhất

  const grid = document.querySelector('.grid');
  grid.innerHTML = ''; // Xoá bài viết cũ cứng

  latestPosts.forEach(post => {
    const card = document.createElement('a');
    card.className = 'post-card';
    card.href = post.link;

    card.innerHTML = `
      <div class="post-title">${post.title}</div>
      <div class="post-meta">${formatDate(post.date)}</div>
      <div class="post-snippet">${post.excerpt}</div>
    `;

    grid.appendChild(card);
  });
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

document.addEventListener('DOMContentLoaded', loadLatestPosts);

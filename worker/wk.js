/**
 * ============================================================================
 * SPAC2 BLOG — CLOUDFLARE WORKER FOR R2 STORAGE & BLOG API (wk.js)
 * ============================================================================
 * Roles:
 * 1. Public Read / R2 Proxy (Optional if blog.spac2.com routes through Worker):
 *    - GET /list.json or GET /p/list.json -> Returns list.json (latest posts index)
 *    - GET /p/:slug or GET /p/:slug.html  -> Returns rendered SEO HTML post from R2
 *    - GET /p/assets/:filename            -> Returns uploaded media/images from R2
 *
 * 2. Admin Management API (Protected by ADMIN_SECRET):
 *    - GET    /api/posts                  -> List all posts from list.json
 *    - GET    /api/post?slug=xxx          -> Get raw HTML + source JSON of a post
 *    - POST   /api/publish                -> Upload rendered HTML to /p/<slug>.html
 *                                            and update list.json in R2
 *    - DELETE /api/post?slug=xxx          -> Delete post from R2 & update list.json
 *    - POST   /api/upload                 -> Upload image/asset to ImgBB API v1
 *    - POST   /api/sync-list              -> Overwrite/rebuild list.json manually
 *
 * ============================================================================
 * REQUIRED ENVIRONMENT VARIABLES & BINDINGS IN CLOUDFLARE WORKER:
 * ============================================================================
 * 1. R2 Bucket Binding:
 *    - Variable Name: BLOG_BUCKET
 *    - Bucket: Your R2 bucket (connected to blog.spac2.com)
 *
 * 2. Environment Variables (Text / Secret):
 *    - ADMIN_SECRET   : (Secret, default: "0372996420") Password/Token to authenticate Admin requests
 *    - IMGBB_API_KEY  : (Optional, default: "bad5648ecb464ce4a66fa132b9a6ab02") ImgBB API v1 Key
 *    - PUBLIC_R2_URL  : (Optional, default: "https://blog.spac2.com")
 *    - BLOG_HOME_URL  : (Optional, default: "https://spac2.com/blog")
 *    - BUCKET_PREFIX  : (Optional, default: "p") -> stores under /p/
 *    - ALLOWED_ORIGIN : (Optional, default: "*") -> e.g. "https://spac2.com"
 * ============================================================================
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    const PUBLIC_R2_URL = (env.PUBLIC_R2_URL || 'https://blog.spac2.com').replace(/\/+$/, '');
    const BLOG_HOME_URL = (env.BLOG_HOME_URL || 'https://spac2.com/blog').replace(/\/+$/, '');
    const BUCKET_PREFIX = (env.BUCKET_PREFIX || 'p').replace(/^\/+|\/+$/g, '');
    const ALLOWED_ORIGIN = env.ALLOWED_ORIGIN || '*';

    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS Preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Helper for JSON responses
    const jsonResponse = (data, status = 200, extraHeaders = {}) => {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...corsHeaders,
          ...extraHeaders,
        },
      });
    };

    // Check R2 Bucket Binding
    if (!env.BLOG_BUCKET) {
      return jsonResponse(
        {
          ok: false,
          error: 'Missing R2 Bucket binding `BLOG_BUCKET`. Please bind your R2 bucket in Worker Settings -> Bindings.',
        },
        500
      );
    }

    // Helper: Authenticate Admin requests (Default pass: 0372996420)
    const isAuthorized = (req) => {
      const secret = env.ADMIN_SECRET || '0372996420';
      const authHeader = req.headers.get('Authorization') || '';
      const tokenFromBearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const tokenFromHeader = (req.headers.get('X-Admin-Secret') || '').trim();
      const token = tokenFromBearer || tokenFromHeader;
      return Boolean(token && token === secret);
    };

    // Helper: Escape XML special characters for sitemap.xml
    const escapeXml = (str) => {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // Helper: Build Google-compliant XML Sitemap (with Image Sitemap extension)
    const buildSitemapXml = (listData) => {
      const blogHomeUrl = BLOG_HOME_URL;
      const nowIso = new Date().toISOString();
      const posts = Array.isArray(listData.posts) ? listData.posts : [];

      const postUrlsXml = posts
        .map((post) => {
          const loc = post.link || post.url || `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/${post.slug}.html`;
          const thumb = post.thumbnail || post.image || '';
          const lastmod = post.updatedAt || post.publishedAt || nowIso;
          const imageXml = thumb
            ? `\n    <image:image>\n      <image:loc>${escapeXml(thumb)}</image:loc>\n      <image:title>${escapeXml(post.title || post.slug)}</image:title>\n    </image:image>`
            : '';
          return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${escapeXml(lastmod)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>${imageXml}\n  </url>`;
        })
        .join('\n');

      return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${escapeXml(blogHomeUrl)}/</loc>
    <lastmod>${escapeXml(listData.updatedAt || nowIso)}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${postUrlsXml}
</urlset>`;
    };

    // Helper: Save list.json AND sitemap.xml (+ robots.txt) to R2
    // Stores in BOTH `p/list.json` & `list.json` and `p/sitemap.xml` & `sitemap.xml`
    const savePostList = async (listData) => {
      if (!Array.isArray(listData.posts)) listData.posts = [];

      // Normalize each post so `thumbnail`, `title`, and `link` are always guaranteed
      listData.posts = listData.posts.map((p) => {
        const slug = String(p.slug || '').trim();
        const resolvedLink = p.link || p.url || `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/${slug}.html`;
        const resolvedThumb = p.thumbnail || p.image || 'https://spac2.com/apple-touch-icon.png';
        return {
          slug,
          title: p.title || slug,
          thumbnail: resolvedThumb,
          link: resolvedLink,
          // Keep aliases for full backward compatibility
          image: resolvedThumb,
          url: resolvedLink,
          description: p.description || '',
          category: p.category || 'Engineering & Updates',
          badge: p.badge || p.category || 'Official Guide',
          author: p.author || 'Spac2 Engineering Team',
          readTime: p.readTime || '5 min read',
          tags: Array.isArray(p.tags) ? p.tags : ['Spac2'],
          path: `/${BUCKET_PREFIX}/${slug}.html`,
          pinned: Boolean(p.pinned),
          publishedAt: p.publishedAt || p.date || new Date().toISOString(),
          updatedAt: p.updatedAt || new Date().toISOString(),
        };
      });

      // Sort posts by publishedAt descending (newest first)
      listData.posts.sort((a, b) => {
        const da = new Date(a.publishedAt || a.date || 0).getTime();
        const db = new Date(b.publishedAt || b.date || 0).getTime();
        return db - da;
      });
      listData.total = listData.posts.length;
      listData.updatedAt = new Date().toISOString();

      const jsonBody = JSON.stringify(listData, null, 2);
      const jsonMetadata = {
        httpMetadata: {
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'public, max-age=30, s-maxage=30',
        },
      };

      const sitemapXml = buildSitemapXml(listData);
      const xmlMetadata = {
        httpMetadata: {
          contentType: 'application/xml; charset=utf-8',
          cacheControl: 'public, max-age=300, s-maxage=300',
        },
      };

      const robotsTxt = `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_R2_URL}/${BUCKET_PREFIX}/sitemap.xml\nSitemap: ${PUBLIC_R2_URL}/sitemap.xml\n`;
      const txtMetadata = {
        httpMetadata: {
          contentType: 'text/plain; charset=utf-8',
          cacheControl: 'public, max-age=3600',
        },
      };

      await Promise.all([
        env.BLOG_BUCKET.put(`${BUCKET_PREFIX}/list.json`, jsonBody, jsonMetadata),
        env.BLOG_BUCKET.put('list.json', jsonBody, jsonMetadata),
        env.BLOG_BUCKET.put(`${BUCKET_PREFIX}/sitemap.xml`, sitemapXml, xmlMetadata),
        env.BLOG_BUCKET.put('sitemap.xml', sitemapXml, xmlMetadata),
        env.BLOG_BUCKET.put(`${BUCKET_PREFIX}/robots.txt`, robotsTxt, txtMetadata),
        env.BLOG_BUCKET.put('robots.txt', robotsTxt, txtMetadata),
      ]);

      return listData;
    };

    // Helper: Read list.json from R2 (auto-creates p/list.json & list.json in R2 if not found!)
    const getPostList = async () => {
      let obj = await env.BLOG_BUCKET.get(`${BUCKET_PREFIX}/list.json`);
      let missingPrefixFile = !obj;
      if (!obj) {
        obj = await env.BLOG_BUCKET.get('list.json');
      }

      if (!obj) {
        const initialList = {
          site: 'Spac2 Blog',
          baseUrl: BLOG_HOME_URL,
          postBaseUrl: `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/`,
          updatedAt: new Date().toISOString(),
          total: 0,
          posts: [],
        };
        // Automatically create list.json and p/list.json in R2 on first access
        return await savePostList(initialList);
      }

      try {
        const parsed = await obj.json();
        const normalized = Array.isArray(parsed)
          ? {
              site: 'Spac2 Blog',
              baseUrl: BLOG_HOME_URL,
              postBaseUrl: `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/`,
              updatedAt: new Date().toISOString(),
              total: parsed.length,
              posts: parsed,
            }
          : {
              site: parsed.site || 'Spac2 Blog',
              baseUrl: BLOG_HOME_URL,
              postBaseUrl: `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/`,
              updatedAt: parsed.updatedAt || new Date().toISOString(),
              total: Array.isArray(parsed.posts) ? parsed.posts.length : 0,
              posts: Array.isArray(parsed.posts) ? parsed.posts : [],
            };

        if (missingPrefixFile) {
          await savePostList(normalized);
        }
        return normalized;
      } catch (e) {
        const fallbackList = {
          site: 'Spac2 Blog',
          baseUrl: BLOG_HOME_URL,
          postBaseUrl: `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/`,
          updatedAt: new Date().toISOString(),
          total: 0,
          posts: [],
        };
        return await savePostList(fallbackList);
      }
    };

    // Helper: Sanitize slug
    const sanitizeSlug = (raw) => {
      return String(raw || '')
        .toLowerCase()
        .trim()
        .replace(/\.html?$/i, '')
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    };

    try {
      // ======================================================================
      // PUBLIC ROUTES (GET list.json, GET /p/..., health check)
      // ======================================================================
      if (method === 'GET' || method === 'HEAD') {
        // 1. Serve list.json
        if (
          pathname === '/list.json' ||
          pathname === `/${BUCKET_PREFIX}/list.json` ||
          pathname === '/api/posts'
        ) {
          const listData = await getPostList();
          const limitParam = parseInt(url.searchParams.get('limit') || '0', 10);
          if (limitParam > 0) {
            return jsonResponse(
              {
                ...listData,
                posts: listData.posts.slice(0, limitParam),
              },
              200,
              { 'Cache-Control': 'public, max-age=30' }
            );
          }
          return jsonResponse(listData, 200, { 'Cache-Control': 'public, max-age=30' });
        }

        // 1b. Serve sitemap.xml & robots.txt (auto-creates in R2 if not present)
        if (pathname === '/sitemap.xml' || pathname === `/${BUCKET_PREFIX}/sitemap.xml`) {
          const listData = await getPostList();
          const xml = buildSitemapXml(listData);
          return new Response(xml, {
            status: 200,
            headers: {
              'Content-Type': 'application/xml; charset=utf-8',
              'Cache-Control': 'public, max-age=300',
              ...corsHeaders,
            },
          });
        }

        if (pathname === '/robots.txt' || pathname === `/${BUCKET_PREFIX}/robots.txt`) {
          const robotsTxt = `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_R2_URL}/${BUCKET_PREFIX}/sitemap.xml\nSitemap: ${PUBLIC_R2_URL}/sitemap.xml\n`;
          return new Response(robotsTxt, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'public, max-age=3600',
              ...corsHeaders,
            },
          });
        }
        if (pathname === '/api/post') {
          const slug = sanitizeSlug(url.searchParams.get('slug'));
          if (!slug) {
            return jsonResponse({ ok: false, error: 'Missing slug parameter' }, 400);
          }

          const [htmlObj, sourceObj, listData] = await Promise.all([
            env.BLOG_BUCKET.get(`${BUCKET_PREFIX}/${slug}.html`),
            env.BLOG_BUCKET.get(`${BUCKET_PREFIX}/.meta/${slug}.json`),
            getPostList(),
          ]);

          const html = htmlObj ? await htmlObj.text() : null;
          const sourceData = sourceObj ? await sourceObj.json() : null;
          const metaItem = listData.posts.find((p) => p.slug === slug) || null;

          if (!html && !metaItem) {
            return jsonResponse({ ok: false, error: 'Post not found' }, 404);
          }

          return jsonResponse({
            ok: true,
            slug,
            meta: metaItem,
            sourceData,
            html,
          });
        }

        // 3. Serve uploaded assets or HTML posts from /p/...
        if (pathname.startsWith(`/${BUCKET_PREFIX}/`)) {
          const key = pathname.replace(/^\/+/, '');
          let obj = await env.BLOG_BUCKET.get(key);

          // If requesting /p/slug without .html, fallback to /p/slug.html
          if (!obj && !key.endsWith('.html') && !key.includes('.')) {
            obj = await env.BLOG_BUCKET.get(`${key}.html`);
          }

          if (!obj) {
            return new Response('404 Not Found on Spac2 Blog R2', {
              status: 404,
              headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders },
            });
          }

          const headers = new Headers(corsHeaders);
          obj.writeHttpMetadata(headers);
          headers.set('etag', obj.httpEtag);
          if (!headers.has('Content-Type')) {
            if (key.endsWith('.json')) {
              headers.set('Content-Type', 'application/json; charset=utf-8');
            } else {
              headers.set('Content-Type', 'text/html; charset=utf-8');
            }
          }
          return new Response(obj.body, { status: 200, headers });
        }

        // 4. Worker Root Status (also initializes list.json in R2 if not present)
        if (pathname === '/' || pathname === '/api/health') {
          const listData = await getPostList();
          return jsonResponse({
            ok: true,
            service: 'Spac2 Blog R2 Worker',
            bucketPrefix: `/${BUCKET_PREFIX}/`,
            publicR2Url: PUBLIC_R2_URL,
            totalPosts: listData.total || 0,
            endpoints: {
              listJson: `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/list.json`,
              postsApi: '/api/posts',
              publishApi: 'POST /api/publish',
              uploadApi: 'POST /api/upload',
              deleteApi: 'DELETE /api/post?slug=...',
            },
          });
        }
      }

      // ======================================================================
      // PROTECTED ADMIN ROUTES (Require ADMIN_SECRET)
      // ======================================================================
      if (!isAuthorized(request)) {
        return jsonResponse(
          {
            ok: false,
            error: 'Unauthorized: Invalid or missing ADMIN_SECRET token.',
          },
          401
        );
      }

      // 0. POST /api/verify -> Verify Admin Login & Auto-Initialize list.json in R2
      if (method === 'POST' && pathname === '/api/verify') {
        const listData = await getPostList();
        return jsonResponse({
          ok: true,
          message: 'Admin authenticated & list.json initialized in R2.',
          publicR2Url: PUBLIC_R2_URL,
          bucketPrefix: `/${BUCKET_PREFIX}/`,
          totalPosts: listData.total || 0,
        });
      }

      // 1. POST /api/publish -> Upload HTML post to R2 & update list.json
      if (method === 'POST' && pathname === '/api/publish') {
        const body = await request.json();
        const slug = sanitizeSlug(body.slug || body.title);
        if (!slug) {
          return jsonResponse({ ok: false, error: 'Missing valid `slug` or `title`.' }, 400);
        }

        const htmlContent = body.html;
        if (!htmlContent || typeof htmlContent !== 'string') {
          return jsonResponse({ ok: false, error: 'Missing rendered `html` content.' }, 400);
        }

        const nowIso = new Date().toISOString();
        const htmlKey = `${BUCKET_PREFIX}/${slug}.html`;
        const cleanKey = `${BUCKET_PREFIX}/${slug}`;
        const postUrl = `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/${slug}.html`;

        const htmlMetadata = {
          httpMetadata: {
            contentType: 'text/html; charset=utf-8',
            cacheControl: 'public, max-age=300',
          },
          customMetadata: {
            slug,
            title: String(body.title || slug).slice(0, 200),
            updatedAt: nowIso,
          },
        };

        // Write both /p/<slug>.html and /p/<slug> so clean URLs & .html URLs both work on R2
        const writePromises = [
          env.BLOG_BUCKET.put(htmlKey, htmlContent, htmlMetadata),
          env.BLOG_BUCKET.put(cleanKey, htmlContent, htmlMetadata),
        ];

        // Save structured editor state in /p/.meta/<slug>.json so Admin can re-edit seamlessly
        if (body.sourceData && typeof body.sourceData === 'object') {
          writePromises.push(
            env.BLOG_BUCKET.put(
              `${BUCKET_PREFIX}/.meta/${slug}.json`,
              JSON.stringify(body.sourceData, null, 2),
              {
                httpMetadata: { contentType: 'application/json; charset=utf-8' },
              }
            )
          );
        }

        await Promise.all(writePromises);

        // Update list.json
        const listData = await getPostList();
        const existingIndex = listData.posts.findIndex((p) => p.slug === slug);
        const existingItem = existingIndex >= 0 ? listData.posts[existingIndex] : null;

        const resolvedThumb =
          body.thumbnail || body.image || existingItem?.thumbnail || existingItem?.image || 'https://spac2.com/apple-touch-icon.png';
        const resolvedLink = body.link || body.url || postUrl;

        const postEntry = {
          slug,
          title: body.title || existingItem?.title || slug,
          thumbnail: resolvedThumb,
          link: resolvedLink,
          image: resolvedThumb,
          url: resolvedLink,
          description: body.description || existingItem?.description || '',
          category: body.category || existingItem?.category || 'Engineering & Updates',
          badge: body.badge || existingItem?.badge || body.category || 'Official Guide',
          author: body.author || existingItem?.author || 'Spac2 Engineering Team',
          readTime: body.readTime || existingItem?.readTime || '5 min read',
          tags: Array.isArray(body.tags)
            ? body.tags
            : typeof body.tags === 'string'
            ? body.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : existingItem?.tags || ['Spac2'],
          path: `/${BUCKET_PREFIX}/${slug}.html`,
          pinned: Boolean(body.pinned ?? existingItem?.pinned ?? false),
          publishedAt: body.publishedAt || existingItem?.publishedAt || nowIso,
          updatedAt: nowIso,
        };

        if (existingIndex >= 0) {
          listData.posts[existingIndex] = postEntry;
        } else {
          listData.posts.unshift(postEntry);
        }

        const updatedList = await savePostList(listData);

        return jsonResponse({
          ok: true,
          message: `Published "${postEntry.title}" to R2 and updated list.json & sitemap.xml.`,
          post: postEntry,
          url: resolvedLink,
          cleanUrl: `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/${slug}`,
          listUrl: `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/list.json`,
          sitemapUrl: `${PUBLIC_R2_URL}/${BUCKET_PREFIX}/sitemap.xml`,
          totalPosts: updatedList.total,
        });
      }

      // 2. DELETE /api/post?slug=xxx -> Remove post from R2 & list.json
      if (method === 'DELETE' && pathname === '/api/post') {
        const slug = sanitizeSlug(url.searchParams.get('slug'));
        if (!slug) {
          return jsonResponse({ ok: false, error: 'Missing `slug` query parameter.' }, 400);
        }

        await Promise.all([
          env.BLOG_BUCKET.delete(`${BUCKET_PREFIX}/${slug}.html`),
          env.BLOG_BUCKET.delete(`${BUCKET_PREFIX}/${slug}`),
          env.BLOG_BUCKET.delete(`${BUCKET_PREFIX}/.meta/${slug}.json`),
        ]);

        const listData = await getPostList();
        listData.posts = listData.posts.filter((p) => p.slug !== slug);
        const updatedList = await savePostList(listData);

        return jsonResponse({
          ok: true,
          message: `Deleted post "${slug}" and updated list.json.`,
          totalPosts: updatedList.total,
        });
      }

      // 3. POST /api/upload -> Upload image to ImgBB API v1 (https://api.imgbb.com/1/upload)
      if (method === 'POST' && pathname === '/api/upload') {
        const imgbbKey = env.IMGBB_API_KEY || 'bad5648ecb464ce4a66fa132b9a6ab02';
        const contentType = request.headers.get('Content-Type') || '';
        const imgbbForm = new FormData();

        if (contentType.includes('multipart/form-data')) {
          const inForm = await request.formData();
          const fileOrImage = inForm.get('image') || inForm.get('file');
          const nameParam = inForm.get('name');
          const expirationParam = inForm.get('expiration');

          if (!fileOrImage) {
            return jsonResponse({ ok: false, error: 'Missing `image` or `file` field in multipart form-data.' }, 400);
          }

          imgbbForm.append('image', fileOrImage);
          if (nameParam) imgbbForm.append('name', String(nameParam));
          if (expirationParam) imgbbForm.append('expiration', String(expirationParam));
        } else {
          // Support JSON payload with base64 or image URL
          const payload = await request.json();
          const rawImage = String(payload.image || payload.base64 || payload.url || '').replace(
            /^data:[^;]+;base64,/,
            ''
          );
          if (!rawImage) {
            return jsonResponse({ ok: false, error: 'Missing `image` (base64 or URL) in request body.' }, 400);
          }
          imgbbForm.append('image', rawImage);
          if (payload.name) imgbbForm.append('name', String(payload.name));
          if (payload.expiration) imgbbForm.append('expiration', String(payload.expiration));
        }

        const imgbbEndpoint = `https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbKey)}`;
        const imgbbRes = await fetch(imgbbEndpoint, {
          method: 'POST',
          body: imgbbForm,
        });

        const imgbbJson = await imgbbRes.json();
        if (!imgbbRes.ok || !imgbbJson.success) {
          return jsonResponse(
            {
              ok: false,
              error: imgbbJson?.error?.message || 'ImgBB upload failed',
              imgbb: imgbbJson,
            },
            imgbbRes.status || 400
          );
        }

        const d = imgbbJson.data || {};
        return jsonResponse({
          ok: true,
          url: d.url || d.display_url,
          display_url: d.display_url,
          url_viewer: d.url_viewer,
          thumb_url: d.thumb?.url || d.url,
          medium_url: d.medium?.url || d.display_url || d.url,
          delete_url: d.delete_url,
          width: d.width,
          height: d.height,
          size: d.size,
          data: d,
        });
      }

      // 4. POST /api/sync-list -> Manually update list.json
      if (method === 'POST' && pathname === '/api/sync-list') {
        const payload = await request.json();
        const currentList = await getPostList();
        if (Array.isArray(payload.posts)) {
          currentList.posts = payload.posts;
        }
        const saved = await savePostList(currentList);
        return jsonResponse({
          ok: true,
          message: 'list.json synchronized successfully.',
          list: saved,
        });
      }

      return jsonResponse({ ok: false, error: `Route not found: ${method} ${pathname}` }, 404);
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: err.message || 'Internal Worker Error',
        },
        500
      );
    }
  },
};


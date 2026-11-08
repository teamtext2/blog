# Hướng dẫn cấu hình Biến Môi Trường & R2 Binding cho Cloudflare Worker (`wk.js`)

Khi triển khai file `worker/wk.js` lên **Cloudflare Workers**, bạn vào **Worker Settings → Bindings** và **Variables and Secrets** để thêm các cấu hình sau:

---

## 1. R2 Bucket Binding (Bắt buộc)

Vào **Settings → Bindings → Add → R2 bucket**:

| Variable name (Tên biến) | R2 Bucket | Ghi chú |
| :--- | :--- | :--- |
| `BLOG_BUCKET` | Chọn bucket R2 của bạn (bucket gắn với domain `blog.spac2.com`) | **Bắt buộc** đặt đúng tên biến là `BLOG_BUCKET` để Worker đọc/ghi bài viết, `list.json` và `sitemap.xml`. |

---

## 2. Environment Variables & Secrets (Biến môi trường)

Vào **Settings → Variables and Secrets → Add**:

| Tên biến (Variable name) | Loại (Type) | Giá trị cần điền (Value) | Bắt buộc? | Mô tả vai trò |
| :--- | :--- | :--- | :--- | :--- |
| `ADMIN_SECRET` | **Secret** (hoặc Text) | `0372996420` | Khuyến nghị (Đã có mặc định là `0372996420`) | Mật khẩu xác thực khi đăng nhập và đăng/sửa/xóa bài từ trang `spac2.com/blog/admin/`. |
| `IMGBB_API_KEY` | **Secret** (hoặc Text) | `bad5648ecb464ce4a66fa132b9a6ab02` | Tùy chọn (Đã có sẵn mặc định trong code) | API Key v1 của ImgBB (`https://api.imgbb.com/1/upload`) dùng để tải ảnh lên ImgBB. |
| `PUBLIC_R2_URL` | **Text** | `https://blog.spac2.com` | Tùy chọn (Mặc định: `https://blog.spac2.com`) | Domain public của R2 dùng để tạo đường dẫn bài viết (`link`), `list.json` và `sitemap.xml`. |
| `BLOG_HOME_URL` | **Text** | `https://spac2.com/blog` | Tùy chọn (Mặc định: `https://spac2.com/blog`) | Đường dẫn trang chủ Blog chính thức dùng trong `list.json` và thẻ `<loc>` gốc của `sitemap.xml`. |
| `BUCKET_PREFIX` | **Text** | `p` | Tùy chọn (Mặc định: `p`) | Thư mục lưu trữ trong R2 (`/p/`). Các bài viết sẽ nằm tại `p/<slug>.html`, danh sách tại `p/list.json` và sitemap tại `p/sitemap.xml`. |
| `ALLOWED_ORIGIN` | **Text** | `*` (hoặc `https://spac2.com`) | Tùy chọn (Mặc định: `*`) | Cấu hình CORS Header cho phép trang chủ `spac2.com/blog` và trang Admin gọi API sang Worker. |

---

## 3. Tóm tắt nhanh (Chỉ cần làm 2 bước là chạy ngay)

Vì các biến `ADMIN_SECRET` (`0372996420`), `IMGBB_API_KEY` (`bad5648ecb464ce4a66fa132b9a6ab02`), `PUBLIC_R2_URL` (`https://blog.spac2.com`), `BLOG_HOME_URL` (`https://spac2.com/blog`) và `BUCKET_PREFIX` (`p`) đã được đặt giá trị mặc định sẵn trong `wk.js`, nên tối thiểu trên Cloudflare Worker bạn chỉ cần:

1. **Bind R2 Bucket** với tên biến: `BLOG_BUCKET`
2. *(Tùy chọn)* Thêm biến `ADMIN_SECRET` = `0372996420` và `IMGBB_API_KEY` = `bad5648ecb464ce4a66fa132b9a6ab02`

---

## 4. Các đường dẫn hệ thống & tự động sinh trên R2

- **Trang chủ Blog chính**: `https://spac2.com/blog`
- **Trang Admin đăng bài**: `https://spac2.com/blog/admin/`
- **Danh sách bài viết trên R2 (`list.json`)**:
  - `https://blog.spac2.com/p/list.json`
  - `https://blog.spac2.com/list.json`
- **Sitemap chuẩn Google SEO trên R2 (`sitemap.xml`)**:
  - `https://blog.spac2.com/p/sitemap.xml`
  - `https://blog.spac2.com/sitemap.xml`
- **Robots (`robots.txt`)**:
  - `https://blog.spac2.com/p/robots.txt`
  - `https://blog.spac2.com/robots.txt`
- **Đường dẫn từng bài viết trên R2**:
  - `https://blog.spac2.com/p/<slug>.html` (và `https://blog.spac2.com/p/<slug>`)

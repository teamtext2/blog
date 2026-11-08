# Spac2 Blog (blog.spac2.com)

Hệ thống Blog tĩnh tối giản cực đoan (Ultra-Minimalist Static Blog), siêu tốc độ với kiến trúc Serverless Git-based Content Management:
- **Trang chủ (`index.html`)**: Giao diện tối giản cực đoan, Header dạng treo (floating suspended pill) bo tròn viền kính mờ, icon bên trái `https://spac2.com/favicon.ico`.
- **Nguồn bài viết (`list.js`)**: Danh sách bài viết dạng `window.BLOG_POSTS`, tự động tráo/chèn bài viết mới vào đầu mảng.
- **Sitemap SEO (`sitemap.xml`)**: Tự động đồng bộ đường dẫn bài viết mới cho Google Bot.
- **Thư mục bài viết (`p/{slug}.html`)**: Bài viết độc lập chuẩn SEO, Open Graph, Twitter Cards, Schema JSON-LD `BlogPosting`.
- **Trang quản trị (`admin/index.html`)**:
  - **Màn hình Đăng nhập (Auth Gate)**: Bảo vệ bằng Passkey bí mật (xác thực trực tuyến qua Cloudflare Worker). Hỗ trợ dán trực tiếp link Worker kèm key (`https://worker-url.workers.dev?key=YOUR_PASSKEY&imgbb=YOUR_IMGBB_KEY`).
  - **Thanh công cụ soạn thảo chuyên nghiệp (Rich Toolbar)**: Hỗ trợ H2/H3/H4, In đậm, In nghiêng, Gạch chân, Gạch ngang, Highlight, Code nội dòng, Bullet List, Numbered List, Checklist công việc, Trích dẫn blockquote, Bảng so sánh (Table), Thẻ số liệu thống kê (Stat Metric), Hộp tóm tắt ý chính (Key Takeaways).
  - **Hộp ghi chú nổi bật (Callout Alerts)**: Hỗ trợ Note (xanh dương), Tip (xanh lá), Warning (vàng), Danger (đỏ) chuẩn giao diện báo chí hiện đại.
  - **Quản lý & Chèn hình ảnh đa dạng (Pro Image Manager)**: Tự động nén nhẹ Canvas + tải ImgBB, chèn ảnh tại vị trí con trỏ bất kỳ, tùy chọn căn lề (Giữa, Tràn viền rộng, Canh trái/phải chữ bao quanh), chú thích caption dưới ảnh, ghép lưới 2 ảnh hoặc 3 ảnh song song (Grid 2/3), khay ảnh gần đây (Recent Media).
  - **Kéo thả & Dán ảnh thông minh**: Kéo thả nhiều file ảnh hoặc bấm Ctrl + V dán ảnh trực tiếp từ clipboard vào bất kỳ vị trí nào trong bài viết.
  - **Chế độ toàn màn hình (Zen Mode)**: Tập trung viết bài không phân tâm.
  - **Xem trước song song thời gian thực (Live Preview)**: Chuyển đổi linh hoạt giữa chế độ Desktop, Mobile (mô phỏng smartphone 375px) và mã HTML Render.
  - **Tự động lưu nháp (Local Draft Auto-Save)**: Tự động lưu nội dung đang viết vào trình duyệt, có nút khôi phục nháp tránh mất dữ liệu.
- **Cloudflare Worker (`worker/wk.js`)**:
  - Tự động tráo file và commit trực tiếp lên GitHub: tạo `p/{slug}.html`, cập nhật `list.js`, cập nhật `sitemap.xml`.

---

## 🔑 Cấu Hình Biến Môi Trường (Environment Variables)

Thông tin bảo mật và kết nối GitHub được thiết lập trên Cloudflare Worker (Variables & Secrets):

| Tên Biến | Loại | Mục Đích |
|---|---|---|
| `ADMIN_SECRET` | Secret | Mã bảo mật Passkey (ví dụ: `0372996420`) để kiểm tra quyền đăng nhập Admin và xuất bản |
| `GITHUB_TOKEN` | Secret | GitHub Personal Access Token (PAT) có quyền **Contents: Read and write** (hoặc scope `repo`) |
| `GITHUB_OWNER` | Variable | Tên tài khoản GitHub sở hữu repo (ví dụ: `teamtext2`) |
| `GITHUB_REPO` | Variable | Tên repository (ví dụ: `blog`) |
| `GITHUB_BRANCH` | Variable | Nhánh làm việc (mặc định: `main`) |

---

## 📁 Cấu Trúc Dự Án

```
d:\website\blog\
├── index.html                  # Trang chủ danh sách bài viết (Tối giản cực đoan)
├── list.js                     # Danh sách bài viết tự động cập nhật
├── sitemap.xml                 # Sitemap XML chuẩn SEO Google
├── p/                          # Thư mục chứa các file bài viết HTML
│   └── chao-mung-den-voi-spac2-blog.html
├── admin/
│   └── index.html              # Admin Console: Gate đăng nhập + Soạn thảo + Nén ảnh Canvas + ImgBB
└── worker/
    ├── wk.js                   # Cloudflare Worker code (Auth Passkey + Tráo file GitHub)
    └── wrangler.toml           # File cấu hình deploy Cloudflare Worker
```

---

## 🚀 Hướng Dẫn Sử Dụng & Triển Khai

### 1. Triển Khai Cloudflare Worker (`worker/wk.js`)

1. Đăng nhập [dash.cloudflare.com](https://dash.cloudflare.com) > **Workers & Pages** > **Create Worker**.
2. Dán mã nguồn từ file [`worker/wk.js`](worker/wk.js) hoặc deploy bằng lệnh `wrangler deploy`.
3. Vào **Settings** > **Variables and Secrets**:
   - Thêm Secret `ADMIN_SECRET`: Đặt mã bảo mật bí mật (ví dụ: `0372996420`).
   - Thêm Secret `GITHUB_TOKEN`: Personal Access Token GitHub (quyền `repo` hoặc **Contents: Read and write**).
   - Thêm Variable `GITHUB_OWNER`: Tên tài khoản GitHub (ví dụ: `teamtext2`).
   - Thêm Variable `GITHUB_REPO`: Tên repository (ví dụ: `blog`).
   - Thêm Variable `GITHUB_BRANCH`: `main`.

### 2. Đăng Nhập & Viết Bài Trên Admin (`admin/index.html`)

1. Mở [`admin/index.html`](admin/index.html) trên trình duyệt.
2. Tại màn hình khóa **Spac2 Admin Gate**:
   - Nhập URL Cloudflare Worker (ví dụ: `https://spac2-blog-worker.xxx.workers.dev`).
   - Nhập Mã bảo mật `ADMIN_SECRET` bạn đã cài đặt trên Cloudflare Worker (ví dụ: `0372996420`).
   - Nhập ImgBB API Key (lấy miễn phí tại [api.imgbb.com](https://api.imgbb.com/)) để kích hoạt chức năng nén và tự động up ảnh.
   - Nhấn **Enter** hoặc click **🔓 Mở Khóa Admin Console**. Worker sẽ xác thực trực tiếp mã bảo mật, đúng thì vào, sai thì ở ngoài!
3. Soạn bài và nhấn **🚀 Xuất Bản Bài Viết**.
3. Tải & Nén ảnh nhẹ:
   - **Ảnh Thumbnail**: Bấm vào khu vực tải ảnh hoặc chọn file từ máy tính -> Trình duyệt tự động nén kích thước nhẹ và up lên ImgBB lấy URL điền vào ô Thumbnail.
   - **Ảnh Bài viết**: Bấm nút **🖼 Tải & Chèn Ảnh** hoặc chỉ cần bấm **Ctrl + V** dán ảnh trực tiếp từ clipboard vào khung nội dung bài viết!
4. Soạn thảo bài viết và bấm **🚀 Đăng Bài Ngay (Tráo File Tự Động)**!

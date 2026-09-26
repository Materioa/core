<svelte:head>
  <title>Brand Guidelines</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://site-assets.fontawesome.com/releases/v6.4.0/css/all.css" />
</svelte:head>

<div class="brand-page">
  <header class="brand-header">
    <div class="logo">Materio</div>
    <div class="version">BRAND GUIDELINES V2.0</div>
  </header>

  <div class="hero">
    <h1>Materio Identity</h1>
    <p>A comprehensive guide to the visual language, elements, and aesthetic principles of the Materio ecosystem.</p>
  </div>

  <!-- Logos -->
  <section>
    <div class="section-title"><span></span> Brand Logos</div>
    <div class="logo-grid">
      <div class="logo-card">
        <img src="/assets/img/materio_new_bk.svg" class="logo-img" alt="Materio Logo Dark" />
      </div>
      <div class="logo-card dark">
        <img src="/assets/img/materio_new_wh.svg" class="logo-img" alt="Materio Logo Light" />
      </div>
      <div class="logo-card">
        <img src="/assets/img/icon.png" class="logo-img" alt="Materio Logo PNG" />
      </div>
      <div class="logo-card">
        <img src="/assets/img/favicon.svg" class="logo-img icon" alt="Materio Icon" />
      </div>
    </div>
  </section>

  <!-- Typography -->
  <section>
    <div class="section-title"><span></span> Typography</div>
    <div class="typo-grid">
      <div class="font-specimen">
        <div class="font-name">Primary Interface Font</div>
        <h2 class="manrope-demo" style="font-size: 32px; font-weight: 800; margin-bottom: 10px;">Manrope</h2>
        <p style="font-size: 13px; color: #ff8400; margin-bottom: 15px; font-weight: 600;">By Colophon Foundry</p>
        <p class="manrope-demo" style="color: #666;">Used for all interface elements, headings, and primary body text. Modern, geometric, and highly legible.</p>
        <div class="size-demo manrope-demo">
          <div class="size-row">
            <div class="size-label">800</div>
            <div style="font-size: 24px; font-weight: 800;">Headline Text</div>
          </div>
          <div class="size-row">
            <div class="size-label">600</div>
            <div style="font-size: 20px; font-weight: 600;">Subheading Bold</div>
          </div>
          <div class="size-row">
            <div class="size-label">400</div>
            <div style="font-size: 16px; font-weight: 400;">Regular Body Information</div>
          </div>
        </div>
      </div>
      <div class="font-specimen">
        <div class="font-name">Secondary / Editorial</div>
        <h2 class="editorial-demo" style="font-size: 28px; font-weight: 700; margin-bottom: 5px;">Libre Baskerville</h2>
        <p style="font-size: 13px; color: #ff8400; margin-bottom: 15px; font-weight: 600;">By Impallari Type</p>
        <p class="editorial-demo" style="font-size: 16px; margin-bottom: 25px; color: #666;">Used for long-form reading, insights, and editorial sections to provide a classic, trustworthy feel.</p>

        <div class="font-name">Monospace / Tertiary</div>
        <h2 class="code-demo" style="font-size: 24px; font-weight: 500; margin-bottom: 5px;">JetBrains Mono</h2>
        <p style="font-size: 13px; color: #ff8400; margin-bottom: 15px; font-weight: 600;">By JetBrains</p>
        <p class="code-demo" style="font-size: 14px; color: #666;">Selected for technical data, code blocks, and system outputs. Optimized for developer-centric information.</p>
      </div>
    </div>
  </section>

  <!-- Colors -->
  <section>
    <div class="section-title"><span></span> Color Palette</div>
    <div class="color-grid">
      <div class="color-card">
        <div class="color-swatch" style="background: #ff5400;"></div>
        <div class="color-info">
          <h3>Brand Deep Orange</h3>
          <code>#ff5400</code>
        </div>
      </div>
      <div class="color-card">
        <div class="color-swatch" style="background: #ff8400;"></div>
        <div class="color-info">
          <h3>Materio Orange</h3>
          <code>#ff8400</code>
        </div>
      </div>
      <div class="color-card">
        <div class="color-swatch" style="background: #121212;"></div>
        <div class="color-info">
          <h3>Jet Black</h3>
          <code>#121212</code>
        </div>
      </div>
      <div class="color-card">
        <div class="color-swatch" style="background: #333333;"></div>
        <div class="color-info">
          <h3>Primary Text</h3>
          <code>#333333</code>
        </div>
      </div>
      <div class="color-card">
        <div class="color-swatch" style="background: #faf9f5; border: 1px solid #eee;"></div>
        <div class="color-info">
          <h3>Canvas Base</h3>
          <code>#faf9f5</code>
        </div>
      </div>
      <div class="color-card">
        <div class="color-swatch" style="background: #ef4444;"></div>
        <div class="color-info">
          <h3>Alert Red</h3>
          <code>#ef4444</code>
        </div>
      </div>
    </div>
  </section>

  <!-- Iconography -->
  <section>
    <div class="section-title"><span></span> Iconography</div>

    <div class="icon-section">
      <h3 class="icon-section-title">FLAGSHIP NAVIGATION ICONS</h3>
      <div class="flagship-grid">
        <div class="flagship-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10.5L12.8825 2.82207C12.6355 2.61407 12.3229 2.5 12 2.5C11.6771 2.5 11.3645 2.61407 11.1175 2.82207L2 10.5" />
            <path d="M20.5 9.5V16C20.5 18.3456 20.5 19.5184 19.8801 20.3263C19.7205 20.5343 19.5343 20.7205 19.3263 20.8801C18.5184 21.5 17.3456 21.5 15 21.5V17C15 15.5858 15 14.8787 14.5607 14.4393C14.1213 14 13.4142 14 12 14C10.5858 14 9.87868 14 9.43934 14.4393C9 14.8787 9 15.5858 9 17V21.5C6.65442 21.5 5.48164 21.5 4.67372 20.8801C4.46572 20.7205 4.27954 20.5343 4.11994 20.3263C3.5 19.5184 3.5 18.3456 3.5 16V9.5" />
          </svg>
          <span>Home</span>
        </div>
        <div class="flagship-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.0045 10.5H12.0135M16 10.5H16.009M8.009 10.5H8.01797" />
            <path d="M2 10.5C2 9.72921 2.01346 8.97679 2.03909 8.2503C2.12282 5.87683 2.16469 4.69009 3.13007 3.71745C4.09545 2.74481 5.3157 2.6926 7.7562 2.58819C9.09517 2.5309 10.5209 2.5 12 2.5C13.4791 2.5 14.9048 2.5309 16.2438 2.58819C18.6843 2.6926 19.9046 2.74481 20.8699 3.71745C21.8353 4.69009 21.8772 5.87683 21.9609 8.2503C21.9865 8.97679 22 9.72921 22 10.5C22 11.2708 21.9865 12.0232 21.9609 12.7497C21.8772 15.1232 21.8353 16.3099 20.8699 17.2826C19.9046 18.2552 18.6843 18.3074 16.2437 18.4118C15.5098 18.4432 14.7498 18.4667 13.9693 18.4815C13.2282 18.4955 12.8576 18.5026 12.532 18.6266C12.2064 18.7506 11.9325 18.9855 11.3845 19.4553L9.20503 21.3242C9.07273 21.4376 8.90419 21.5 8.72991 21.5C8.32679 21.5 8 21.1732 8 20.7701V18.4219C7.91842 18.4186 7.83715 18.4153 7.75619 18.4118C5.31569 18.3074 4.09545 18.2552 3.13007 17.2825C2.16469 16.3099 2.12282 15.1232 2.03909 12.7497C2.01346 12.0232 2 11.2708 2 10.5Z" />
          </svg>
          <span>Chat</span>
        </div>
        <div class="flagship-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15.5 18C15.5 19.933 13.933 21.5 12 21.5C10.067 21.5 8.5 19.933 8.5 18" />
            <path d="M19.2311 18H4.76887C3.79195 18 3 17.208 3 16.2311C3 15.762 3.18636 15.3121 3.51809 14.9803L4.12132 14.3771C4.68393 13.8145 5 13.0514 5 12.2558V9.5C5 5.63401 8.13401 2.5 12 2.5C15.866 2.5 19 5.634 19 9.5V12.2558C19 13.0514 19.3161 13.8145 19.8787 14.3771L20.4819 14.9803C20.8136 15.3121 21 15.762 21 16.2311C21 17.208 20.208 18 19.2311 18Z" />
          </svg>
          <span>Alerts</span>
        </div>
        <div class="flagship-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.5055 2.01874C12.8289 2.83455 12 7.5 12 7.5V22C12 22 12.8867 17.1272 18.0004 16.5588C18.5493 16.4978 19 16.0576 19 15.5058V3.39309C19 2.5654 18.3216 1.87638 17.5055 2.01874Z" />
            <path d="M5.33333 5.00001C7.79379 4.99657 10.1685 5.88709 12 7.5V22C10.1685 20.3871 7.79379 19.4966 5.33333 19.5C3.77132 19.5 2.99032 19.5 2.64526 19.2792C2.4381 19.1466 2.35346 19.0619 2.22086 18.8547C2 18.5097 2 17.8941 2 16.6629V8.40322C2 6.97543 2 6.26154 2.54874 5.68286C3.09748 5.10418 3.65923 5.07432 4.78272 5.0146C4.965 5.00491 5.14858 5.00001 5.33333 5.00001Z" />
            <path d="M12 22.001C13.8315 20.3881 16.2062 19.4976 18.6667 19.501C20.2287 19.501 21.0097 19.501 21.3547 19.2802C21.5619 19.1476 21.6465 19.0629 21.7791 18.8558C22 18.5107 22 17.8951 22 16.6639V8.40424C22 6.97645 22 6.26256 21.4513 5.68388C20.9025 5.1052 20.1235 5.05972 19 5" />
          </svg>
          <span>Insights</span>
        </div>
      </div>
    </div>

    <div class="icon-section">
      <h3 class="icon-section-title">INTERFACE ICONS GRID</h3>
      <div class="common-icons-grid">
        <div class="icon-box"><i class="fa-regular fa-book-open"></i></div>
        <div class="icon-box"><i class="fa-regular fa-bookmark"></i></div>
        <div class="icon-box"><i class="fa-regular fa-comments"></i></div>
        <div class="icon-box"><i class="fa-regular fa-cog"></i></div>
        <div class="icon-box"><i class="fa-regular fa-display"></i></div>
        <div class="icon-box"><i class="fa-regular fa-copy"></i></div>
        <div class="icon-box"><i class="fa-regular fa-moon"></i></div>
        <div class="icon-box"><i class="fa-regular fa-trash"></i></div>
        <div class="icon-box"><i class="fa-regular fa-download"></i></div>
        <div class="icon-box"><i class="fa-regular fa-expand"></i></div>
        <div class="icon-box"><i class="fa-regular fa-lightbulb"></i></div>
        <div class="icon-box"><i class="fa-regular fa-circle-info"></i></div>
        <div class="icon-box"><i class="fa-regular fa-thumbs-up"></i></div>
        <div class="icon-box"><i class="fa-regular fa-bell"></i></div>
        <div class="icon-box"><i class="fa-regular fa-magnifying-glass"></i></div>
        <div class="icon-box"><i class="fa-regular fa-user"></i></div>
      </div>
    </div>
  </section>

  <!-- Art Direction -->
  <section>
    <div class="section-title"><span></span> Art Direction</div>

    <div class="icon-section" style="margin-bottom: 40px;">
      <h3 class="icon-section-title">COVER PHOTOGRAPHY STYLES</h3>
      <div class="cover-grid">
        <img src="/assets/img/covers/ai-future.webp" alt="Cover 1" />
        <img src="/assets/img/covers/howto.webp" alt="Cover 2" />
        <img src="/assets/img/covers/jdbc.webp" alt="Cover 3" />
        <img src="/assets/img/covers/cn.webp" alt="Cover 4" />
        <img src="/assets/img/covers/cover.webp" alt="Cover 5" />
      </div>
    </div>

    <div class="art-grid">
      <div class="art-card">
        <h3>Glassmorphism</h3>
        <p style="margin-bottom: 20px; color: #666;">The interface uses extensive backdrop-blur filters to create a layered, modern feel that maintains context while focusing on the foreground.</p>
        <div class="glass-demo">
          <div class="glass-overlay"></div>
        </div>
      </div>
      <div class="art-card">
        <h3>Geometric Framing</h3>
        <p style="margin-bottom: 20px; color: #666;">Corners use a refined "Squircle" shape for headers and cards, providing a more premium, organic feel than standard radii.</p>
        <div class="squircle-demo"></div>
      </div>
      <div class="art-card">
        <h3>Interactive Cursors</h3>
        <p style="margin-bottom: 20px; color: #666;">Custom SVG-based cursors enhance the brand identity consistently across all platform tools.</p>
        <div class="cursor-demo">Hover over me to see the brand pointer</div>
      </div>
    </div>
  </section>

  <footer class="brand-footer">
    <p>&copy; 2026 Materio Ecosystem. All Rights Reserved.</p>
    <p class="footer-sub">Proprietary Design System of Materioa</p>
  </footer>
</div>

<style>
  .brand-page {
    font-family: 'Manrope', sans-serif;
    background-color: #faf9f5;
    color: #333;
    line-height: 1.6;
    overflow-x: hidden;
  }

  .brand-header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    padding: 20px 40px;
    background: rgba(250, 249, 245, 0.8);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    z-index: 1000;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }

  .logo {
    font-size: 24px;
    font-weight: 800;
    color: #ff8400;
    letter-spacing: -1px;
  }

  .version {
    font-size: 14px;
    font-weight: 700;
    color: #999;
  }

  .hero {
    padding: 160px 40px 80px;
    text-align: center;
    background: radial-gradient(circle at top right, rgba(255, 132, 0, 0.05), transparent 40%),
      radial-gradient(circle at bottom left, rgba(255, 132, 0, 0.03), transparent 30%);
  }

  .hero h1 {
    font-size: 64px;
    font-weight: 800;
    letter-spacing: -3px;
    margin-bottom: 20px;
    background: linear-gradient(135deg, #333 0%, #666 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .hero p {
    font-size: 20px;
    color: #666;
    max-width: 600px;
    margin: 0 auto;
  }

  section {
    padding: 100px 40px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .section-title {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 40px;
    display: flex;
    align-items: center;
    gap: 15px;
  }

  .section-title span {
    width: 40px;
    height: 4px;
    background: #ff8400;
    border-radius: 2px;
  }

  .logo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
  }

  .logo-card {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
  }

  .logo-card.dark {
    background: #121212;
    color: white;
  }

  .logo-img {
    max-width: 200px;
    height: auto;
  }

  .logo-img.icon {
    max-width: 60px;
  }

  .typo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 40px;
  }

  .font-specimen {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  .font-name {
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #ff8400;
    margin-bottom: 20px;
    font-weight: 700;
  }

  .manrope-demo { font-family: 'Manrope', sans-serif; }
  .editorial-demo { font-family: 'Libre Baskerville', serif; }
  .code-demo { font-family: 'JetBrains Mono', monospace; }

  .size-demo { margin-top: 20px; }

  .size-row {
    display: flex;
    align-items: baseline;
    gap: 20px;
    margin-bottom: 10px;
  }

  .size-label {
    font-size: 12px;
    color: #999;
    width: 40px;
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 20px;
  }

  .color-card {
    background: white;
    padding: 15px;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    transition: transform 0.3s ease;
  }

  .color-card:hover {
    transform: translateY(-5px);
  }

  .color-swatch {
    height: 120px;
    border-radius: 8px;
    margin-bottom: 15px;
  }

  .color-info h3 {
    font-size: 16px;
    font-weight: 700;
  }

  .color-info code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: #666;
  }

  .icon-section {
    background: white;
    padding: 60px;
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    margin-bottom: 40px;
  }

  .icon-section-title {
    text-align: center;
    margin-bottom: 40px;
    font-size: 14px;
    letter-spacing: 2px;
    color: #999;
  }

  .flagship-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 40px;
    justify-content: center;
  }

  .flagship-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    width: 120px;
    padding: 20px;
    border-radius: 12px;
    transition: background 0.3s ease;
  }

  .flagship-icon:hover {
    background: #faf9f5;
  }

  .flagship-icon svg {
    width: 32px;
    height: 32px;
    color: #ff8400;
  }

  .flagship-icon span {
    font-size: 12px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
  }

  .common-icons-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px;
    max-width: 600px;
    margin: 0 auto;
  }

  .icon-box {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #faf9f5;
    border-radius: 12px;
    font-size: 24px;
    color: #333;
    transition: all 0.3s ease;
  }

  .icon-box:hover {
    background: rgba(255, 132, 0, 0.1);
    color: #ff8400;
    transform: scale(1.05);
  }

  .cover-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 15px;
  }

  .cover-grid img {
    width: 100%;
    height: 260px;
    object-fit: cover;
    border-radius: 12px;
  }

  .art-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 30px;
  }

  .art-card {
    background: white;
    padding: 40px;
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    position: relative;
    overflow: hidden;
  }

  .art-card h3 {
    margin-bottom: 20px;
    font-weight: 700;
  }

  .glass-demo {
    height: 150px;
    background: linear-gradient(45deg, #ff8400, #ffcd94);
    border-radius: 12px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .glass-overlay {
    width: 80%;
    height: 60%;
    background: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 12px;
  }

  .squircle-demo {
    width: 80px;
    height: 80px;
    background: #ff8400;
    border-radius: 25px;
    margin: 0 auto;
  }

  .cursor-demo {
    padding: 20px;
    background: #faf9f5;
    border-radius: 10px;
    text-align: center;
    font-weight: 600;
  }

  .brand-footer {
    padding: 80px 40px;
    text-align: center;
    color: #666;
    font-size: 14px;
    border-top: 1px solid rgba(0, 0, 0, 0.05);
    background: white;
    margin-top: 100px;
  }

  .footer-sub {
    margin-top: 10px;
    font-size: 12px;
    opacity: 0.5;
  }

  @media (max-width: 768px) {
    .hero h1 {
      font-size: 40px;
    }

    section {
      padding: 60px 20px;
    }
  }
</style>

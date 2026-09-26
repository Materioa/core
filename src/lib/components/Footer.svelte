<script>
  // We'll declare setTheme globally in app.html just like Jekyll did, 
  // or we can invoke it from window.
  const currentYear = new Date().getFullYear();
</script>

<footer class="site-footer">
  <div class="footer-content">
    <p>&copy; {currentYear} Materio All rights reserved.</p>
  </div>

  <div class="theme-switcher" style="margin: 1rem auto 0; background: var(--bg); border: 1px solid lightgray; border-radius: 9999px; display: flex; gap: 0.5rem; padding: 0.5rem 1rem; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); align-items: center; width: fit-content;">
    <button aria-label="Light Mode" on:click={() => window.setTheme('light')} id="light-btn" style="background: none; border: none; cursor: var(--f-cursor-pointer); font-size: 1rem; color: var(--text);">
      
    </button>
    <button aria-label="Dark Mode" on:click={() => window.setTheme('dark')} id="dark-btn" style="background: none; border: none; cursor: var(--f-cursor-pointer); font-size: 1rem; color: var(--text);">
      
    </button>
    <button aria-label="System Theme" on:click={() => window.setTheme('system')} id="system-btn" style="background: none; border: none; cursor: var(--f-cursor-pointer); font-size: 1rem; color: var(--text);">
      
    </button>
  </div>
</footer>

// Apply the saved theme before the first paint (no flash). Kept in sync by src/lib/theme.ts.
try {
  var m = localStorage.getItem('teledrive.theme')
  var dark = m ? m === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  if (dark) document.querySelector('meta[name="theme-color"]').content = '#1f2023'
} catch (e) {}

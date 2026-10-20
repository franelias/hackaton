// The PDFs are the browser's print (Save as PDF): the paper is white, so it prints with the light theme, and the
// title becomes the file's suggested name.
export function printAsPdf(title: string) {
  const root = document.documentElement, dark = root.classList.contains('dark'), prev = document.title
  root.classList.remove('dark'); document.title = title
  addEventListener('afterprint', () => { root.classList.toggle('dark', dark); document.title = prev }, { once: true })
  print()
}

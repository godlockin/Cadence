import { useTheme as useNextTheme } from 'next-themes'

/** resolved dark-mode flag (client component helper). */
export function useTheme(): {
  theme: string | undefined
  resolvedTheme: string | undefined
  setTheme: (theme: string) => void
  toggle: () => void
} {
  const { theme, resolvedTheme, setTheme } = useNextTheme()
  const toggle = (): void => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }
  return { theme, resolvedTheme, setTheme, toggle }
}

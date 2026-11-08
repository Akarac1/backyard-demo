import { LangProvider } from '@/components/Lang';

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return <LangProvider>{children}</LangProvider>;
}

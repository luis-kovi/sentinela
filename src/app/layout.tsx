import type { ReactNode } from "react";

export const metadata = {
  title: "PR Hub",
  description: "Plataforma de acionamento de pronta resposta"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}

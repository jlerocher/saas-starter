import { Header } from "@/components/navigation/header";
import { ThemeProvider } from "@/components/ui/theme-provider";

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head />
            <body>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
                    <section className="flex flex-col min-h-screen">
                        <Header />
                        {children}
                    </section>
                </ThemeProvider>
            </body>
        </html>
    );
}

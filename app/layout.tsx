import { UserProvider } from "@/lib/auth";
import { getUser } from "@/lib/db/queries";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
    title: "Next.js SaaS Starter",
    description: "Get started quickly with Next.js, Postgres, and Stripe.",
};

export const viewport: Viewport = {
    maximumScale: 1,
};

const manrope = Manrope({ subsets: ["latin"] });

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const userPromise = getUser();

    return (
        <html
            lang="en"
            className={`bg-background text-foreground ${manrope.className}`}
            suppressHydrationWarning
        >
            <body className="min-h-[100dvh]">
                <UserProvider userPromise={userPromise}>
                    {children}
                </UserProvider>
            </body>
        </html>
    );
}

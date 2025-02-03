"use client";

import { User } from "@/lib/db/schema";
import { createContext, ReactNode, useContext } from "react";

type UserContextType = {
    userPromise: Promise<User | null>;
};

const UserContext = createContext<UserContextType | null>(null);

export function useUser(): UserContextType {
    let context = useContext(UserContext);
    if (context === null) {
        throw new Error("useUser must be used within a UserProvider");
    }
    return context;
}

export function UserProvider({
    children,
    userPromise,
}: {
    children: ReactNode;
    userPromise: Promise<User | null>;
}) {
    return (
        <UserContext.Provider value={{ userPromise }}>
            {children}
        </UserContext.Provider>
    );
}

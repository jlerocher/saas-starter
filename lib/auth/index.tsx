"use client";

import { User } from "@/lib/db/schema";
import { createContext, JSX, ReactNode, useContext } from "react";

type UserContextType = {
    userPromise: Promise<User | null>;
};

const UserContext = createContext<UserContextType | null>(null);

/**
 * Custom hook to access the user context.
 *
 * This hook provides access to the user context, which contains information
 * about the current user. It must be used within a `UserProvider` component.
 *
 * @returns {UserContextType} The current user context.
 * @throws {Error} If the hook is used outside of a `UserProvider`.
 */
export function useUser(): UserContextType {
    const context = useContext(UserContext);
    if (context === null) {
        throw new Error("useUser must be used within a UserProvider");
    }
    return context;
}

/**
 * Provides the user context to its children components.
 *
 * @param {Object} props - The properties object.
 * @param {ReactNode} props.children - The child components to be wrapped by the provider.
 * @param {Promise<User | null>} props.userPromise - A promise that resolves to a User object or null.
 *
 * @returns {JSX.Element} The UserContext provider wrapping the children components.
 */
export function UserProvider({
    children,
    userPromise,
}: {
    children: ReactNode;
    userPromise: Promise<User | null>;
}): JSX.Element {
    return (
        <UserContext.Provider value={{ userPromise }}>
            {children}
        </UserContext.Provider>
    );
}

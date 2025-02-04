"use server";

import {
    validatedAction,
    validatedActionWithUser,
} from "@/lib/auth/middleware";
import { comparePasswords, hashPassword, setSession } from "@/lib/auth/session";
import { db } from "@/lib/db/drizzle";
import { getUser, getUserWithTeam } from "@/lib/db/queries";
import {
    activityLogs,
    ActivityType,
    invitations,
    teamMembers,
    teams,
    User,
    users,
    type NewActivityLog,
    type NewTeam,
    type NewTeamMember,
    type NewUser,
} from "@/lib/db/schema";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

async function logActivity(
    teamId: number | null | undefined,
    userId: number,
    type: ActivityType,
    ipAddress?: string,
) {
    if (teamId === null || teamId === undefined) {
        return;
    }
    const newActivity: NewActivityLog = {
        teamId,
        userId,
        action: type,
        ipAddress: ipAddress || "",
    };
    await db.insert(activityLogs).values(newActivity);
}

const signInSchema = z.object({
    email: z.string().email().min(3).max(255),
    password: z.string().min(8).max(100),
});

const signUpSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    inviteId: z.string().optional(),
});

const updatePasswordSchema = z
    .object({
        currentPassword: z.string().min(8).max(100),
        newPassword: z.string().min(8).max(100),
        confirmPassword: z.string().min(8).max(100),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: "Passwords don't match",
        path: ["confirmPassword"],
    });

const deleteAccountSchema = z.object({
    password: z.string().min(8).max(100),
});

const updateAccountSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email address"),
});

const removeTeamMemberSchema = z.object({
    memberId: z.number(),
});

const inviteTeamMemberSchema = z.object({
    email: z.string().email("Invalid email address"),
    role: z.enum(["MEMBER", "OWNER", "ADMIN"]),
});

/**
 * Handles the sign-in process for a user.
 *
 * @param data - The validated data containing the user's email and password.
 * @param formData - The form data containing additional information such as redirect and priceId.
 * @returns An object containing an error message if the sign-in fails, or initiates a session and redirects the user upon successful sign-in.
 *
 * The function performs the following steps:
 * 1. Retrieves the user and associated team from the database based on the provided email.
 * 2. Checks if the user exists and if the provided password is valid.
 * 3. If the user does not exist or the password is invalid, returns an error message.
 * 4. If the user exists and the password is valid, sets the session and logs the sign-in activity.
 * 5. Redirects the user to the appropriate page based on the form data.
 */
export const signIn = validatedAction(signInSchema, async (data, formData) => {
    const { email, password } = data;

    const userWithTeam = await db
        .select({
            user: users,
            team: teams,
        })
        .from(users)
        .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
        .leftJoin(teams, eq(teamMembers.teamId, teams.id))
        .where(eq(users.email, email))
        .limit(1);

    if (userWithTeam.length === 0) {
        return {
            error: "Invalid email or password. Please try again.",
            email,
            password,
        };
    }

    const { user: foundUser, team: foundTeam } = userWithTeam[0];

    const isPasswordValid = await comparePasswords(
        password,
        foundUser.passwordHash,
    );

    if (!isPasswordValid) {
        return {
            error: "Invalid email or password. Please try again.",
            email,
            password,
        };
    }

    await Promise.all([
        setSession(foundUser),
        logActivity(foundTeam?.id, foundUser.id, ActivityType.SIGN_IN),
    ]);

    const redirectTo = formData.get("redirect") as string | null;
    if (redirectTo === "checkout") {
        const priceId = formData.get("priceId") as string;
        return createCheckoutSession({ team: foundTeam, priceId });
    }

    redirect("/dashboard");
});

/**
 * Handles the sign-up process for a new user.
 *
 * @param {Object} data - The validated data from the sign-up form.
 * @param {string} data.email - The email address of the new user.
 * @param {string} data.password - The password for the new user.
 * @param {string} [data.inviteId] - The optional invitation ID if the user is signing up via an invitation.
 * @param {FormData} formData - The form data containing additional information.
 *
 * @returns {Promise<Object>} The result of the sign-up process, which may include an error message or a redirect.
 *
 * @throws {Error} If there is an issue with database operations or hashing the password.
 */
export const signUp = validatedAction(signUpSchema, async (data, formData) => {
    const { email, password, inviteId } = data;

    const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

    if (existingUser.length > 0) {
        return {
            error: "Failed to create user. Please try again.",
            email,
            password,
        };
    }

    const passwordHash = await hashPassword(password);

    const newUser: NewUser = {
        email,
        passwordHash,
        role: "OWNER", // Default role, will be overridden if there's an invitation
    };

    const [createdUser] = await db.insert(users).values(newUser).returning();

    if (!createdUser) {
        return {
            error: "Failed to create user. Please try again.",
            email,
            password,
        };
    }

    let teamId: number;
    let userRole: "MEMBER" | "ADMIN" | "OWNER";
    let createdTeam: typeof teams.$inferSelect | null = null;

    if (inviteId) {
        // Check if there's a valid invitation
        const [invitation] = await db
            .select()
            .from(invitations)
            .where(
                and(
                    eq(invitations.id, parseInt(inviteId)),
                    eq(invitations.email, email),
                    eq(invitations.status, "pending"),
                ),
            )
            .limit(1);

        if (invitation) {
            teamId = invitation.teamId;
            userRole = invitation.role;

            await db
                .update(invitations)
                .set({ status: "accepted" })
                .where(eq(invitations.id, invitation.id));

            await logActivity(
                teamId,
                createdUser.id,
                ActivityType.ACCEPT_INVITATION,
            );

            [createdTeam] = await db
                .select()
                .from(teams)
                .where(eq(teams.id, teamId))
                .limit(1);
        } else {
            return { error: "Invalid or expired invitation.", email, password };
        }
    } else {
        // Create a new team if there's no invitation
        const newTeam: NewTeam = {
            name: `${email.split("@")[0]}'s Team`,
        };

        [createdTeam] = await db.insert(teams).values(newTeam).returning();

        if (!createdTeam) {
            return {
                error: "Failed to create team. Please try again.",
                email,
                password,
            };
        }

        teamId = createdTeam.id;
        userRole = "OWNER";

        await logActivity(teamId, createdUser.id, ActivityType.CREATE_TEAM);
    }

    const newTeamMember: NewTeamMember = {
        userId: createdUser.id,
        teamId: teamId,
        role: userRole,
    };

    await Promise.all([
        db.insert(teamMembers).values(newTeamMember),
        logActivity(teamId, createdUser.id, ActivityType.SIGN_UP),
        setSession(createdUser),
    ]);

    const redirectTo = formData.get("redirect") as string | null;
    if (redirectTo === "checkout") {
        const priceId = formData.get("priceId") as string;
        return createCheckoutSession({ team: createdTeam, priceId });
    }

    redirect("/dashboard");
});

/**
 * Signs out the current user by performing the following actions:
 * 1. Retrieves the current user.
 * 2. Retrieves the user's team information.
 * 3. Logs the sign-out activity for the user and their team.
 * 4. Deletes the session cookie.
 *
 * @returns {Promise<void>} A promise that resolves when the sign-out process is complete.
 */
export async function signOut(): Promise<void> {
    const user = (await getUser()) as User;
    const userWithTeam = await getUserWithTeam(user.id);
    await logActivity(userWithTeam?.teamId, user.id, ActivityType.SIGN_OUT);
    (await cookies()).delete("session");
}

/**
 * Updates the user's password after validating the current password and ensuring the new password is different.
 *
 * @param {Object} data - The data containing the current and new passwords.
 * @param {string} data.currentPassword - The user's current password.
 * @param {string} data.newPassword - The user's new password.
 * @param {Object} _ - Placeholder for additional arguments (not used).
 * @param {Object} user - The user object containing user details.
 * @param {string} user.passwordHash - The hashed password of the user.
 * @param {string} user.id - The ID of the user.
 *
 * @returns {Promise<Object>} - An object indicating the success or failure of the password update.
 * @returns {Object} error - An error message if the current password is incorrect or the new password is the same as the current password.
 * @returns {Object} success - A success message if the password is updated successfully.
 */
export const updatePassword = validatedActionWithUser(
    updatePasswordSchema,
    async (data, _, user) => {
        const { currentPassword, newPassword } = data;

        const isPasswordValid = await comparePasswords(
            currentPassword,
            user.passwordHash,
        );

        if (!isPasswordValid) {
            return { error: "Current password is incorrect." };
        }

        if (currentPassword === newPassword) {
            return {
                error: "New password must be different from the current password.",
            };
        }

        const newPasswordHash = await hashPassword(newPassword);
        const userWithTeam = await getUserWithTeam(user.id);

        await Promise.all([
            db
                .update(users)
                .set({ passwordHash: newPasswordHash })
                .where(eq(users.id, user.id)),
            logActivity(
                userWithTeam?.teamId,
                user.id,
                ActivityType.UPDATE_PASSWORD,
            ),
        ]);

        return { success: "Password updated successfully." };
    },
);

/**
 * Deletes a user account after validating the provided password.
 *
 * @param {object} data - The data containing the password for validation.
 * @param {object} _ - Unused parameter.
 * @param {object} user - The user object containing user details.
 *
 * @returns {Promise<object>} - An object containing an error message if the password is incorrect.
 *
 * @throws {Error} - Throws an error if the account deletion process fails.
 *
 * The function performs the following steps:
 * 1. Validates the provided password against the stored password hash.
 * 2. Logs the account deletion activity.
 * 3. Soft deletes the user account by setting the `deletedAt` timestamp and modifying the email to ensure uniqueness.
 * 4. Removes the user from their team if they belong to one.
 * 5. Deletes the session cookie and redirects the user to the sign-in page.
 */
export const deleteAccount = validatedActionWithUser(
    deleteAccountSchema,
    async (data, _, user) => {
        const { password } = data;

        const isPasswordValid = await comparePasswords(
            password,
            user.passwordHash,
        );
        if (!isPasswordValid) {
            return { error: "Incorrect password. Account deletion failed." };
        }

        const userWithTeam = await getUserWithTeam(user.id);

        await logActivity(
            userWithTeam?.teamId,
            user.id,
            ActivityType.DELETE_ACCOUNT,
        );

        // Soft delete
        await db
            .update(users)
            .set({
                deletedAt: sql`CURRENT_TIMESTAMP`,
                email: sql`CONCAT(email, '-', id, '-deleted')`, // Ensure email uniqueness
            })
            .where(eq(users.id, user.id));

        if (userWithTeam?.teamId) {
            await db
                .delete(teamMembers)
                .where(
                    and(
                        eq(teamMembers.userId, user.id),
                        eq(teamMembers.teamId, userWithTeam.teamId),
                    ),
                );
        }

        (await cookies()).delete("session");
        redirect("/sign-in");
    },
);

/**
 * Updates the account information for a user.
 *
 * This function validates the provided data against the `updateAccountSchema`
 * and then updates the user's account information in the database. It also logs
 * the activity of updating the account.
 *
 * @param data - The data containing the new account information (name and email).
 * @param _ - Unused parameter.
 * @param user - The user object containing the user's ID.
 * @returns An object indicating the success of the account update.
 */
export const updateAccount = validatedActionWithUser(
    updateAccountSchema,
    async (data, _, user) => {
        const { name, email } = data;
        const userWithTeam = await getUserWithTeam(user.id);

        await Promise.all([
            db.update(users).set({ name, email }).where(eq(users.id, user.id)),
            logActivity(
                userWithTeam?.teamId,
                user.id,
                ActivityType.UPDATE_ACCOUNT,
            ),
        ]);

        return { success: "Account updated successfully." };
    },
);

/**
 * Removes a team member from the user's team.
 *
 * This function validates the action using `removeTeamMemberSchema` and ensures that the user is part of a team.
 * If the user is not part of a team, it returns an error message.
 * Otherwise, it deletes the team member from the database and logs the activity.
 *
 * @param data - The data containing the member ID to be removed.
 * @param _ - Unused parameter.
 * @param user - The user performing the action.
 * @returns An object indicating the success or failure of the operation.
 */
export const removeTeamMember = validatedActionWithUser(
    removeTeamMemberSchema,
    async (data, _, user) => {
        const { memberId } = data;
        const userWithTeam = await getUserWithTeam(user.id);

        if (!userWithTeam?.teamId) {
            return { error: "User is not part of a team" };
        }

        await db
            .delete(teamMembers)
            .where(
                and(
                    eq(teamMembers.id, memberId),
                    eq(teamMembers.teamId, userWithTeam.teamId),
                ),
            );

        await logActivity(
            userWithTeam.teamId,
            user.id,
            ActivityType.REMOVE_TEAM_MEMBER,
        );

        return { success: "Team member removed successfully" };
    },
);

/**
 * Invites a team member to join the user's team.
 *
 * This function validates the input data using `inviteTeamMemberSchema` and checks if the user is part of a team.
 * If the user is not part of a team, it returns an error. It also checks if the user to be invited is already a member
 * of the team or if an invitation has already been sent to the email. If either condition is met, it returns an error.
 * Otherwise, it creates a new invitation and logs the activity.
 *
 * @param data - The data containing the email and role of the team member to be invited.
 * @param _ - Unused parameter.
 * @param user - The user who is inviting the team member.
 * @returns An object containing either an error message or a success message.
 */
export const inviteTeamMember = validatedActionWithUser(
    inviteTeamMemberSchema,
    async (data, _, user) => {
        const { email, role } = data;
        const userWithTeam = await getUserWithTeam(user.id);

        if (!userWithTeam?.teamId) {
            return { error: "User is not part of a team" };
        }

        const existingMember = await db
            .select()
            .from(users)
            .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
            .where(
                and(
                    eq(users.email, email),
                    eq(teamMembers.teamId, userWithTeam.teamId),
                ),
            )
            .limit(1);

        if (existingMember.length > 0) {
            return { error: "User is already a member of this team" };
        }

        // Check if there's an existing invitation
        const existingInvitation = await db
            .select()
            .from(invitations)
            .where(
                and(
                    eq(invitations.email, email),
                    eq(invitations.teamId, userWithTeam.teamId),
                    eq(invitations.status, "pending"),
                ),
            )
            .limit(1);

        if (existingInvitation.length > 0) {
            return {
                error: "An invitation has already been sent to this email",
            };
        }

        // Create a new invitation
        await db.insert(invitations).values({
            teamId: userWithTeam.teamId,
            email,
            role: role.toUpperCase() as "MEMBER" | "ADMIN" | "OWNER",
            invitedBy: user.id,
            status: "pending",
        });

        await logActivity(
            userWithTeam.teamId,
            user.id,
            ActivityType.INVITE_TEAM_MEMBER,
        );

        // TODO: Send invitation email and include ?inviteId={id} to sign-up URL
        // await sendInvitationEmail(email, userWithTeam.team.name, role)

        return { success: "Invitation sent successfully" };
    },
);

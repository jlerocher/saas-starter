"use client";

import { inviteTeamMember } from "@/app/(login)/actions";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useUser } from "@/lib/auth";
import { Loader2, PlusCircle } from "lucide-react";
import { use, useActionState } from "react";

type ActionState = {
    error?: string;
    success?: string;
};

export function InviteTeamMember() {
    const { userPromise } = useUser();
    const user = use(userPromise);
    const isOwner = user?.role === "OWNER";
    const [inviteState, inviteAction, isInvitePending] = useActionState<
        ActionState,
        FormData
    >(inviteTeamMember, { error: "", success: "" });

    return (
        <Card>
            <CardHeader>
                <CardTitle>Add another team member</CardTitle>
            </CardHeader>
            <CardContent>
                <form action={inviteAction} className="flex flex-col space-y-5">
                    <div className="">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            name="email"
                            type="email"
                            placeholder="Enter email"
                            required
                            disabled={!isOwner}
                        />
                    </div>
                    <div className="">
                        <Label>Role</Label>
                        <RadioGroup
                            defaultValue="member"
                            name="role"
                            className="flex space-x-4"
                            disabled={!isOwner}
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="member" id="member" />
                                <Label htmlFor="member">Member</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="owner" id="owner" />
                                <Label htmlFor="owner">Owner</Label>
                            </div>
                        </RadioGroup>
                    </div>
                    {inviteState?.error && (
                        <p className="text-red-500">{inviteState.error}</p>
                    )}
                    {inviteState?.success && (
                        <p className="text-green-500">{inviteState.success}</p>
                    )}
                    <Button
                        type="submit"
                        className="bg-orange-500 hover:bg-orange-600 text-white"
                        disabled={isInvitePending || !isOwner}
                    >
                        {isInvitePending ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Inviting...
                            </>
                        ) : (
                            <>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Invite Member
                            </>
                        )}
                    </Button>
                </form>
            </CardContent>
            {!isOwner && (
                <CardFooter>
                    <p className="text-sm text-muted-foreground">
                        You must be a team owner to invite new members.
                    </p>
                </CardFooter>
            )}
        </Card>
    );
}

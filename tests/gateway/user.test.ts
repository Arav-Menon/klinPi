import {beforeEach, describe, it, expect} from "vitest";
import {prisma} from "../../packages/gateway/src/lib/prisma";
import request from "supertest";
import app from "../../packages/gateway/src/app";

const PASSWORD_HASH = "$2b$12$IIJd6p1/RWRSgCes86FCx.PWnExawsl1Lh7n3ZjlhGItBUjXKwMEC";
const PASSWORD = "password123";

async function createUserAndGetCookie(data: { email: string; name?: string }) {
    const db = prisma();
    const user = await db.user.create({
        data: {
            email: data.email,
            name: data.name ?? "Test User",
            passwordHash: PASSWORD_HASH,
        },
    });

    const authResponse = await request(app).post("/api/v1/auth/signin").send({
        email: data.email,
        password: PASSWORD,
    });

    const setCookieHeader = authResponse.headers["set-cookie"];
    console.log(setCookieHeader)
    const cookieList = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    const cookieValue = cookieList
        .find((c: string) => c.startsWith("klinpi_token="))
        ?.split(";")[0];
    return {user, cookie: cookieValue!};
}

const TEST_EMAILS = [
    "profile-get@test.com",
    "profile-unauth@test.com",
    "profile-put@test.com",
    "profile-put-new@test.com",
    "profile-put-dup@test.com",
    "profile-put-invalid@test.com",
    "profile-put-nouser@test.com",
    "profile-patch@test.com",
    "profile-patch-new@test.com",
    "profile-patch-dup@test.com",
    "profile-patch-invalid@test.com",
    "profile-delete@test.com",
    "profile-delete-invalid@test.com",
];

describe("GET /profile", () => {
    beforeEach(async () => {
        const db = prisma();
        await db.user.deleteMany({where: {email: {in: TEST_EMAILS}}});
    });

    it("should return the authenticated user's profile", async () => {
        const {user, cookie} = await createUserAndGetCookie({
            email: "profile-get@test.com",
            name: "Profile User",
        });

        const response = await request(app)
            .get("/api/v1/user/profile")
            .set("Cookie", cookie);

        expect(response.status).toBe(200);
        expect(response.body.user.id).toBe(user.id);
        expect(response.body.user.email).toBe("profile-get@test.com");
        expect(response.body.user.name).toBe("Profile User");
        expect(response.body.user).not.toHaveProperty("passwordHash");
    });

    it("should return 401 without a cookie", async () => {
        const response = await request(app).get("/api/v1/user/profile");
        expect(response.status).toBe(401);
    });

    it("should return 401 with an invalid cookie", async () => {
        const response = await request(app)
            .get("/api/v1/user/profile")
            .set("Cookie", "klinpi_token=invalid.token.here");
        expect(response.status).toBe(401);
    });
});

describe("PUT /profile", () => {
    beforeEach(async () => {
        const db = prisma();
        await db.user.deleteMany({where: {email: {in: TEST_EMAILS}}});
    });

    it("should update name, email, and password", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-put@test.com",
        });

        const response = await request(app)
            .put("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({
                name: "Updated Name",
                email: "profile-put-new@test.com",
                password: "newpassword99",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(200);
        expect(response.body.user.name).toBe("Updated Name");
        expect(response.body.user.email).toBe("profile-put-new@test.com");

        const db = prisma();
        const user = await db.user.findUnique({where: {id: response.body.user.id}});
        expect(user?.name).toBe("Updated Name");
        expect(user?.email).toBe("profile-put-new@test.com");
    });

    it("should return 401 with wrong current password", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-put-invalid@test.com",
        });

        const response = await request(app)
            .put("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({
                name: "Updated Name",
                email: "profile-put-invalid@test.com",
                password: "newpassword99",
                currentPassword: "wrongpassword",
            });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe("Invalid current password");
    });

    it("should return 409 if email is already in use", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-put@test.com",
        });
        await createUserAndGetCookie({
            email: "profile-put-dup@test.com",
        });

        const response = await request(app)
            .put("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({
                name: "Updated Name",
                email: "profile-put-dup@test.com",
                password: "newpassword99",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe("Email is already in use");
    });

    it("should return 400 if required fields are missing", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-put@test.com",
        });

        const response = await request(app)
            .put("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({});

        expect(response.status).toBe(400);
    });

    it("should return 400 if password is too short", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-put@test.com",
        });

        const response = await request(app)
            .put("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({
                name: "Updated Name",
                email: "profile-put@test.com",
                password: "short",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(400);
    });

    it("should return 401 without authentication", async () => {
        const response = await request(app)
            .put("/api/v1/user/profile")
            .send({
                name: "Updated Name",
                email: "profile-put@test.com",
                password: "newpassword99",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(401);
    });
});

describe("PATCH /profile", () => {
    beforeEach(async () => {
        const db = prisma();
        await db.user.deleteMany({where: {email: {in: TEST_EMAILS}}});
    });

    it("should update only the name", async () => {
        const {user, cookie} = await createUserAndGetCookie({
            email: "profile-patch@test.com",
            name: "Original Name",
        });

        const response = await request(app)
            .patch("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({
                name: "Patched Name",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(200);
        expect(response.body.user.name).toBe("Patched Name");
        expect(response.body.user.email).toBe("profile-patch@test.com");
    });

    it("should update only the email", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-patch@test.com",
        });

        const response = await request(app)
            .patch("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({
                email: "profile-patch-new@test.com",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(200);
        expect(response.body.user.email).toBe("profile-patch-new@test.com");
    });

    it("should update only the password", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-patch@test.com",
        });

        const response = await request(app)
            .patch("/api/v1/user/profile")s
            .set("Cookie", cookie)
            .send({
                password: "brandnewpass123",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(200);

        const signinAfter = await request(app).post("/api/v1/auth/signin").send({
            email: "profile-patch@test.com",
            password: "brandnewpass123",
        });
        expect(signinAfter.status).toBe(200);
    });

    it("should return 401 with wrong current password", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-patch-invalid@test.com",
        });

        const response = await request(app)
            .patch("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({
                name: "Should Not Work",
                currentPassword: "wrongpassword",
            });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe("Invalid current password");
    });

    it("should return 409 if email is already in use", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-patch@test.com",
        });
        await createUserAndGetCookie({
            email: "profile-patch-dup@test.com",
        });

        const response = await request(app)
            .patch("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({
                email: "profile-patch-dup@test.com",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe("Email is already in use");
    });

    it("should return 400 without currentPassword", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-patch@test.com",
        });

        const response = await request(app)
            .patch("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({name: "New Name"});

        expect(response.status).toBe(400);
    });

    it("should return 401 without authentication", async () => {
        const response = await request(app)
            .patch("/api/v1/user/profile")
            .send({
                name: "New Name",
                currentPassword: PASSWORD,
            });

        expect(response.status).toBe(401);
    });
});

describe("DELETE /profile", () => {
    beforeEach(async () => {
        const db = prisma();
        await db.user.deleteMany({where: {email: {in: TEST_EMAILS}}});
    });

    it("should delete the user account", async () => {
        const {user, cookie} = await createUserAndGetCookie({
            email: "profile-delete@test.com",
        });

        const response = await request(app)
            .delete("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({currentPassword: PASSWORD});

        expect(response.status).toBe(200);
        expect(response.body.message).toBe("Account deleted successfully");

        const db = prisma();
        const deleted = await db.user.findUnique({where: {id: user.id}});
        expect(deleted).toBeNull();
    });

    it("should return 401 with wrong current password", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-delete-invalid@test.com",
        });

        const response = await request(app)
            .delete("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({currentPassword: "wrongpassword"});

        expect(response.status).toBe(401);
        expect(response.body.error).toBe("Invalid current password");

        const db = prisma();
        const stillExists = await db.user.findUnique({
            where: {email: "profile-delete-invalid@test.com"},
        });
        expect(stillExists).not.toBeNull();
    });

    it("should return 400 without currentPassword", async () => {
        const {cookie} = await createUserAndGetCookie({
            email: "profile-delete@test.com",
        });

        const response = await request(app)
            .delete("/api/v1/user/profile")
            .set("Cookie", cookie)
            .send({});

        expect(response.status).toBe(400);
    });

    it("should return 401 without authentication", async () => {
        const response = await request(app)
            .delete("/api/v1/user/profile")
            .send({currentPassword: PASSWORD});

        expect(response.status).toBe(401);
    });
});

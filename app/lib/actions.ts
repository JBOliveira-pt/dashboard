"use server";

import { signIn, auth } from "@/auth";
import { AuthError } from "next-auth";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import postgres from "postgres";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require" });

// Helper function to check admin permissions
async function checkAdminPermission() {
    const session = await auth();
    if (!session?.user) {
        throw new Error("Unauthorized: No session");
    }
    const userRole = (session.user as any).role;
    if (userRole !== "admin") {
        throw new Error("Unauthorized: Admin access required");
    }
}

const FormSchema = z.object({
    id: z.string(),
    customerId: z.string({
        invalid_type_error: "Please select a customer.",
    }),
    amount: z.coerce.number().gt(0, {
        message: "Please enter an amount greater than $0.",
    }),
    status: z.enum(["pending", "paid"], {
        invalid_type_error: "Please select an invoice status.",
    }),
    date: z.string(),
});

const CreateInvoice = FormSchema.omit({ id: true, date: true });
const UpdateInvoice = FormSchema.omit({ id: true, date: true });

export type State = {
    errors?: {
        customerId?: string[];
        amount?: string[];
        status?: string[];
    };
    message?: string | null;
};

const CustomerFormSchema = z.object({
    firstName: z
        .string()
        .trim()
        .min(1, { message: "Please enter a first name." }),
    lastName: z
        .string()
        .trim()
        .min(1, { message: "Please enter a last name." }),
    email: z.string().email({ message: "Please enter a valid email." }),
});

const CreateCustomer = CustomerFormSchema;
const UpdateCustomer = CustomerFormSchema;

export type CustomerState = {
    errors?: {
        firstName?: string[];
        lastName?: string[];
        email?: string[];
    };
    message?: string | null;
};

// Maximum photo size: 5MB
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

async function persistPhotoToDatabase(
    file: File | null,
    entityType: "customer" | "user",
    entityId: string,
) {
    if (!file || file.size === 0) {
        return null;
    }

    if (file.size > MAX_PHOTO_SIZE) {
        throw new Error(
            `Photo size exceeds ${MAX_PHOTO_SIZE / 1024 / 1024}MB limit`,
        );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Insert photo into the database
    const tableName = entityType === "customer" ? "customers" : "users";
    await sql`
        UPDATE ${sql(tableName)}
        SET photo = ${buffer}
        WHERE id = ${entityId}
    `;

    return `/api/image/${entityType}/${entityId}`;
}

async function saveCustomerPhoto(
    file: File | null,
    customerId: string,
): Promise<string | null> {
    return persistPhotoToDatabase(file, "customer", customerId);
}

async function saveUserPhoto(
    file: File | null,
    userId: string,
): Promise<string | null> {
    return persistPhotoToDatabase(file, "user", userId);
}

export async function authenticate(
    prevState: string | undefined,
    formData: FormData,
) {
    try {
        await signIn("credentials", formData);
    } catch (error) {
        if (error instanceof AuthError) {
            switch (error.type) {
                case "CredentialsSignin":
                    return "Invalid credentials.";
                default:
                    return "Something went wrong.";
            }
        }
        throw error;
    }
}

export async function createInvoice(prevState: State, formData: FormData) {
    // Validate form using Zod
    const validatedFields = CreateInvoice.safeParse({
        customerId: formData.get("customerId"),
        amount: formData.get("amount"),
        status: formData.get("status"),
    });

    // If form validation fails, return errors early. Otherwise, continue.
    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing Fields. Failed to Create Invoice.",
        };
    }

    // Prepare data for insertion into the database
    const { customerId, amount, status } = validatedFields.data;
    const amountInCents = amount * 100;
    const date = new Date().toISOString().split("T")[0];

    // Insert data into the database
    try {
        await sql`
    INSERT INTO invoices (customer_id, amount, status, date)
    VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
  `;
    } catch (error) {
        console.error(error);
        return {
            message: "Database Error: Failed to Create Invoice.",
        };
    }
    // Revalidate the cache for the invoices page and redirect the user.
    revalidatePath("/dashboard/invoices");
    redirect("/dashboard/invoices");
}

export async function updateInvoice(
    id: string,
    prevState: State,
    formData: FormData,
) {
    // Check admin permission
    try {
        await checkAdminPermission();
    } catch (error) {
        return {
            message: "Unauthorized: Only admins can update invoices.",
        };
    }

    const validatedFields = UpdateInvoice.safeParse({
        customerId: formData.get("customerId"),
        amount: formData.get("amount"),
        status: formData.get("status"),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing Fields. Failed to Update Invoice.",
        };
    }

    const { customerId, amount, status } = validatedFields.data;
    const amountInCents = amount * 100;

    try {
        await sql`
      UPDATE invoices
      SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
      WHERE id = ${id}
    `;
    } catch (error) {
        return { message: "Database Error: Failed to Update Invoice." };
    }

    revalidatePath("/dashboard/invoices");
    redirect("/dashboard/invoices");
}

export async function deleteInvoice(id: string) {
    // Check admin permission
    try {
        await checkAdminPermission();
    } catch (error) {
        throw new Error("Unauthorized: Only admins can delete invoices.");
    }

    try {
        await sql`DELETE FROM invoices WHERE id = ${id}`;
    } catch (error) {
        throw new Error("Database Error: Failed to delete invoice.");
    }

    revalidatePath("/dashboard/invoices");
}

export async function createCustomer(
    prevState: CustomerState,
    formData: FormData,
) {
    try {
        await checkAdminPermission();
    } catch (error) {
        return {
            message: "Unauthorized: Only admins can create customers.",
        };
    }

    const validatedFields = CreateCustomer.safeParse({
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing or invalid fields. Failed to create customer.",
        };
    }

    const imageFile = formData.get("imageFile");
    if (!(imageFile instanceof File) || imageFile.size === 0) {
        return {
            message: "Please upload a customer photo.",
        };
    }

    const { firstName, lastName, email } = validatedFields.data;
    const fullName = `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");

    let customerId: string;
    try {
        const result = await sql`
      INSERT INTO customers (id, name, email)
      VALUES (gen_random_uuid(), ${fullName}, ${email})
      RETURNING id
    `;
        customerId = result[0].id;
    } catch (error) {
        console.error(error);
        return {
            message: "Database Error: Failed to create customer.",
        };
    }

    // Save photo after customer is created
    try {
        await saveCustomerPhoto(imageFile, customerId);
    } catch (error) {
        console.error(error);
        return {
            message: `Failed to upload photo: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
    }

    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/(overview)");
    redirect("/dashboard/customers");
}

export async function updateCustomer(
    id: string,
    prevState: CustomerState,
    formData: FormData,
) {
    try {
        await checkAdminPermission();
    } catch (error) {
        return {
            message: "Unauthorized: Only admins can update customers.",
        };
    }

    const validatedFields = UpdateCustomer.safeParse({
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing or invalid fields. Failed to update customer.",
        };
    }

    const imageFile = formData.get("imageFile");
    if (!(imageFile instanceof File) || imageFile.size === 0) {
        return {
            message: "Please upload a new customer photo.",
        };
    }

    const { firstName, lastName, email } = validatedFields.data;
    const fullName = `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");

    try {
        await sql`
      UPDATE customers
      SET name = ${fullName}, email = ${email}
      WHERE id = ${id}
    `;
    } catch (error) {
        console.error(error);
        return { message: "Database Error: Failed to update customer." };
    }

    // Save photo after customer is updated
    try {
        await saveCustomerPhoto(imageFile, id);
    } catch (error) {
        console.error(error);
        return {
            message: `Failed to upload photo: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
    }

    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/(overview)");
    redirect("/dashboard/customers");
}

export async function deleteCustomer(id: string) {
    try {
        await checkAdminPermission();
    } catch (error) {
        throw new Error("Unauthorized: Only admins can delete customers.");
    }

    try {
        await sql`DELETE FROM customers WHERE id = ${id}`;
    } catch (error) {
        console.error(error);
        throw new Error(
            "Database Error: Failed to delete customer. Remove related invoices first.",
        );
    }

    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/invoices");
    revalidatePath("/dashboard/(overview)");
}

const UserFormSchema = z.object({
    firstName: z
        .string()
        .trim()
        .min(1, { message: "Please enter a first name." }),
    lastName: z
        .string()
        .trim()
        .min(1, { message: "Please enter a last name." }),
    email: z.string().email({ message: "Please enter a valid email." }),
    password: z
        .string()
        .min(6, { message: "Password must be at least 6 characters." })
        .optional()
        .or(z.literal("")),
    role: z.enum(["admin", "user"], {
        invalid_type_error: "Please select a valid role.",
    }),
});

const CreateUser = UserFormSchema.extend({
    password: z
        .string()
        .min(6, { message: "Password must be at least 6 characters." }),
});

const UpdateUser = UserFormSchema;

export type UserState = {
    errors?: {
        firstName?: string[];
        lastName?: string[];
        email?: string[];
        password?: string[];
        role?: string[];
    };
    message?: string | null;
};

export async function createUser(prevState: UserState, formData: FormData) {
    try {
        await checkAdminPermission();
    } catch (error) {
        return {
            message: "Unauthorized: Only admins can create users.",
        };
    }

    const validatedFields = CreateUser.safeParse({
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
        password: formData.get("password"),
        role: formData.get("role"),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing or invalid fields. Failed to create user.",
        };
    }

    const imageFile = formData.get("imageFile");
    const { firstName, lastName, email, password, role } = validatedFields.data;
    const fullName = `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");

    // Hash the password
    const bcrypt = require("bcrypt");
    const hashedPassword = await bcrypt.hash(password, 10);

    let userId: string;
    try {
        const result = await sql`
            INSERT INTO users (id, name, email, password, role)
            VALUES (gen_random_uuid(), ${fullName}, ${email}, ${hashedPassword}, ${role})
            RETURNING id
        `;
        userId = result[0].id;
    } catch (error) {
        console.error(error);
        return {
            message: "Database Error: Failed to create user.",
        };
    }

    // Save photo if provided
    if (imageFile instanceof File && imageFile.size > 0) {
        try {
            await saveUserPhoto(imageFile, userId);
        } catch (error) {
            console.error(error);
            return {
                message: `Failed to upload photo: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    revalidatePath("/dashboard/users");
    redirect("/dashboard/users");
}

export async function updateUser(
    id: string,
    prevState: UserState,
    formData: FormData,
) {
    try {
        await checkAdminPermission();
    } catch (error) {
        return {
            message: "Unauthorized: Only admins can update users.",
        };
    }

    const validatedFields = UpdateUser.safeParse({
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
        password: formData.get("password"),
        role: formData.get("role"),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: "Missing or invalid fields. Failed to update user.",
        };
    }

    const { firstName, lastName, email, password, role } = validatedFields.data;
    const fullName = `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");

    try {
        // Update user, conditionally updating password if provided
        if (password && password.length >= 6) {
            const bcrypt = require("bcrypt");
            const hashedPassword = await bcrypt.hash(password, 10);
            await sql`
                UPDATE users
                SET name = ${fullName}, email = ${email}, password = ${hashedPassword}, role = ${role}
                WHERE id = ${id}
            `;
        } else {
            await sql`
                UPDATE users
                SET name = ${fullName}, email = ${email}, role = ${role}
                WHERE id = ${id}
            `;
        }
    } catch (error) {
        console.error(error);
        return { message: "Database Error: Failed to update user." };
    }

    // Save photo if provided
    const imageFile = formData.get("imageFile");
    if (imageFile instanceof File && imageFile.size > 0) {
        try {
            await saveUserPhoto(imageFile, id);
        } catch (error) {
            console.error(error);
            return {
                message: `Failed to upload photo: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
        }
    }

    revalidatePath("/dashboard/users");
    redirect("/dashboard/users");
}

export async function deleteUser(id: string) {
    try {
        await checkAdminPermission();
    } catch (error) {
        throw new Error("Unauthorized: Only admins can delete users.");
    }

    try {
        await sql`DELETE FROM users WHERE id = ${id}`;
    } catch (error) {
        console.error(error);
        throw new Error("Database Error: Failed to delete user.");
    }

    revalidatePath("/dashboard/users");
}

import { NextRequest, NextResponse } from "next/server";
import postgres from "postgres";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require" });

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ type: string; id: string }> },
) {
    try {
        const { type, id } = await params;

        // Validate entity type
        if (type !== "customer" && type !== "user") {
            return NextResponse.json(
                { error: "Invalid image type" },
                { status: 400 },
            );
        }

        const tableName = type === "customer" ? "customers" : "users";

        // Fetch photo from database
        const result = await sql`
            SELECT photo FROM ${sql(tableName)}
            WHERE id = ${id}
        `;

        if (result.length === 0 || !result[0].photo) {
            return NextResponse.json(
                { error: "Image not found" },
                { status: 404 },
            );
        }

        const photo = result[0].photo;

        // Return image with appropriate content type
        return new NextResponse(photo, {
            headers: {
                "Content-Type": "image/png", // Default to PNG, could be improved by storing mime type
                "Cache-Control": "public, max-age=3600", // Cache for 1 hour
            },
        });
    } catch (error) {
        console.error("Error fetching image:", error);
        return NextResponse.json(
            { error: "Failed to fetch image" },
            { status: 500 },
        );
    }
}

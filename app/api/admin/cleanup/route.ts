import { auth } from "@/auth";
import postgres from "postgres";
import { NextRequest, NextResponse } from "next/server";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require" });

// Customers que devem ser deletados (foram criados durante testes)
const CUSTOMERS_TO_DELETE = ["Hector Simpson", "Steven Tey", "Emil L"];

export async function POST(request: NextRequest) {
    try {
        // Verificar autenticação e permissões admin
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized: No session" },
                { status: 401 },
            );
        }

        const userRole = (session.user as any).role;
        if (userRole !== "admin") {
            return NextResponse.json(
                { error: "Unauthorized: Admin access required" },
                { status: 403 },
            );
        }

        const results = {
            deletedCustomers: [] as string[],
            errors: [] as string[],
        };

        // Para cada customer a deletar
        for (const customerName of CUSTOMERS_TO_DELETE) {
            try {
                // Buscar o customer
                const customers = await sql`
          SELECT id FROM customers WHERE name = ${customerName}
        `;

                if (customers.length === 0) {
                    console.log(`Customer "${customerName}" não encontrado`);
                    continue;
                }

                const customer = customers[0];

                // Deletar invoices associadas
                await sql`DELETE FROM invoices WHERE customer_id = ${customer.id}`;

                // Deletar o customer (photo será removido automaticamente via cascade)
                await sql`DELETE FROM customers WHERE id = ${customer.id}`;

                results.deletedCustomers.push(customerName);
                console.log(`Customer deletado: ${customerName}`);
            } catch (err) {
                const errMsg = `Erro ao deletar "${customerName}": ${err}`;
                results.errors.push(errMsg);
                console.error(errMsg);
            }
        }

        return NextResponse.json({
            message: "Limpeza concluída",
            deletedCustomers: results.deletedCustomers,
            errors: results.errors,
        });
    } catch (error) {
        console.error("Cleanup error:", error);
        return NextResponse.json(
            { error: String(error), message: "Limpeza falhou" },
            { status: 500 },
        );
    }
}

import bcrypt from "bcrypt";
import postgres from "postgres";

const sql = postgres(process.env.POSTGRES_URL!, { ssl: "require" });

async function seedAdmin() {
    try {
        const email = "admin@example.com";
        const password = "admin1234";

        // Gerar hash da password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Verificar se o admin já existe
        const existingUser = await sql`
            SELECT * FROM users WHERE email = ${email}
        `;

        if (existingUser.length > 0) {
            console.log("❌ Usuário admin já existe!");
            return;
        }

        // Inserir novo usuário admin
        const result = await sql`
            INSERT INTO users (id, name, email, password, role)
            VALUES (
                gen_random_uuid(),
                'Admin',
                ${email},
                ${hashedPassword},
                'admin'
            )
            RETURNING id, name, email, role;
        `;

        console.log("✅ Usuário admin criado com sucesso!");
        console.log("Email:", result[0].email);
        console.log("Role:", result[0].role);
        console.log("Password: admin1234");
    } catch (error) {
        console.error("❌ Erro ao criar usuário admin:", error);
        process.exit(1);
    }
}

seedAdmin();

# 🔐 Admin User Setup Guide

## Resumo das Alterações Implementadas

Um novo sistema de permissões foi implementado para controlar o acesso às funcionalidades de editar e apagar invoices.

---

## 📋 O que foi feito:

### 1. **Sistema de Roles no Banco de Dados**

-   Adicionado campo `role` à tabela `users` (tipo VARCHAR, padrão: 'user')
-   Valores possíveis: `'admin'` ou `'user'`

### 2. **Autenticação com Role**

-   Atualizado `auth.ts` para incluir `role` nos callbacks JWT e Session
-   O `role` é agora propagado em toda a aplicação via session

### 3. **Verificação de Permissões nas Server Actions**

-   `updateInvoice()`: Requer role `'admin'`
-   `deleteInvoice()`: Requer role `'admin'`
-   Retorna erro se usuário não for admin

### 4. **Botões Condicionais**

-   Botões de editar e apagar agora só aparecem para admins
-   Usuários normais não veem os botões (retornam `null`)

---

## 🚀 Como Criar o Usuário Admin:

### **Opção 1: Automático via Seed (Recomendado)**

1. Execute a rota de seed do banco de dados:

```bash
curl http://localhost:3000/seed
```

Ou navegue em seu navegador para:

```
http://localhost:3000/seed
```

**Resposta esperada:**

```json
{
    "message": "Database seeded successfully",
    "admin": {
        "created": true,
        "email": "admin@example.com",
        "password": "admin1234"
    }
}
```

### **Opção 2: Script TypeScript**

Se quiser executar via script:

```bash
pnpm add tsx --save-dev
pnpm seed:admin
```

---

## 🔑 Credenciais do Admin Padrão

| Campo        | Valor               |
| ------------ | ------------------- |
| **Email**    | `admin@example.com` |
| **Password** | `admin1234`         |
| **Role**     | `admin`             |

---

## 🧪 Testando as Funcionalidades

### **Passo 1: Login como Admin**

1. Acesse http://localhost:3000/login
2. Digite:
    - Email: `admin@example.com`
    - Password: `admin1234`
3. Clique em Login

### **Passo 2: Testar Permissões**

1. Acesse `/dashboard/invoices`
2. Você deve ver os botões de **Editar ✏️** e **Apagar 🗑️** em cada invoice
3. Clique em "Editar" para modificar uma invoice
4. Clique em "Apagar" para deletar uma invoice

### **Passo 3: Testar com Usuário Normal**

1. Faça logout
2. Login com outro usuário (ex: `user@nextmail.com` / `password`)
3. Acesse `/dashboard/invoices`
4. Os botões de editar e apagar **NÃO** aparecem
5. Se tentar acessar diretamente a URL de edição, recebe erro de permissão

---

## 📁 Arquivos Modificados

| Arquivo                       | Alteração                                                |
| ----------------------------- | -------------------------------------------------------- |
| `auth.ts`                     | Adicionados callbacks JWT e Session com role             |
| `auth.config.ts`              | Sem alterações (mantém estrutura)                        |
| `app/lib/definitions.ts`      | Adicionado campo `role` ao tipo `User`                   |
| `app/lib/actions.ts`          | Adicionada função `checkAdminPermission()`               |
| `app/seed/route.ts`           | Adicionado campo `role` ao schema e função `seedAdmin()` |
| `app/ui/invoices/buttons.tsx` | Botões agora verificam role antes de renderizar          |
| `package.json`                | Adicionado script `seed:admin`                           |

---

## 🔒 Segurança

-   ✅ Senhas são hashadas com bcrypt (10 rounds)
-   ✅ Verificação de role ocorre no servidor (Server Actions)
-   ✅ Tokens JWT incluem role (verificável no servidor)
-   ✅ Botões só aparecem se autorizado
-   ✅ Ações no backend rejeitam usuários não-admin

---

## 📝 Customizando o Admin

Para criar um admin com diferentes credenciais, edite `app/seed/route.ts`:

```typescript
async function seedAdmin() {
    const email = "seu-email@example.com"; // ← Mude aqui
    const password = "sua-senha-segura"; // ← Mude aqui
    // ... resto do código
}
```

Depois execute:

```bash
curl http://localhost:3000/seed
```

---

## 🐛 Troubleshooting

### "Unauthorized: Admin access required"

-   Certifique-se de que está logado como admin
-   Verifique se o email está correto: `admin@example.com`

### Botões não aparecem

-   Limpe o cache do navegador (Ctrl+Shift+Delete)
-   Faça logout e login novamente
-   Verifique se a sessão está sendo carregada corretamente

### Erro ao editar/apagar

-   Verifique se seu usuário tem `role = 'admin'` no banco
-   Cheque os logs do servidor para mais detalhes

---

## ✨ Próximas Melhorias

-   [ ] Dashboard administrativo para gerenciar roles
-   [ ] Audit log de ações realizadas
-   [ ] Diferentes níveis de permissão (viewer, editor, admin)
-   [ ] 2FA (Two-Factor Authentication)

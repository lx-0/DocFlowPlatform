const prisma = require('../src/db/client');

const PERMISSIONS = [
  { name: 'documents:read', description: 'Read and view documents' },
  { name: 'documents:write', description: 'Upload and create documents' },
  { name: 'documents:approve', description: 'Approve or reject documents in workflows' },
  { name: 'admin:users', description: 'Manage users' },
  { name: 'admin:roles', description: 'Manage roles and permissions' },
];

const ROLES = [
  {
    name: 'admin',
    description: 'Full system access',
    permissions: ['documents:read', 'documents:write', 'documents:approve', 'admin:users', 'admin:roles'],
  },
  {
    name: 'approver',
    description: 'Can review and approve documents',
    permissions: ['documents:read', 'documents:approve'],
  },
  {
    name: 'submitter',
    description: 'Can upload and submit documents',
    permissions: ['documents:read', 'documents:write'],
  },
  {
    name: 'viewer',
    description: 'Read-only access to documents',
    permissions: ['documents:read'],
  },
];

async function main() {
  console.log('Seeding RBAC roles and permissions...');

  // Upsert permissions
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: { description: perm.description },
      create: perm,
    });
  }

  // Upsert roles with their permissions
  for (const roleDef of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: { description: roleDef.description },
      create: { name: roleDef.name, description: roleDef.description },
    });

    for (const permName of roleDef.permissions) {
      const permission = await prisma.permission.findUnique({ where: { name: permName } });
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  // Backward-compat: assign submitter role to existing users with null roleId
  const submitterRole = await prisma.role.findUnique({ where: { name: 'submitter' } });
  if (submitterRole) {
    await prisma.user.updateMany({
      where: { roleId: null },
      data: { roleId: submitterRole.id },
    });
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

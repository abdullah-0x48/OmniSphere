import type { Site } from '../../../shared/types.ts';
import type {
  IDeviceRepository,
  ISiteRepository,
  SiteListFilter,
  TenantContext,
} from '../repositories/types.ts';
import { Errors } from '../utils/errors.ts';
import { generateId } from '../utils/ids.ts';
import type { AuditService } from './auditService.ts';

export class SiteService {
  constructor(
    private readonly sites: ISiteRepository,
    private readonly devices: IDeviceRepository,
    private readonly audit: AuditService,
  ) {}

  private resolveWriteTenantId(ctx: TenantContext): string {
    if (ctx.activeTenantId) {
      return ctx.activeTenantId;
    }
    if (ctx.tenantIds.length === 1) {
      return ctx.tenantIds[0];
    }
    throw Errors.validation('Select a working tenant before managing sites');
  }

  list(ctx: TenantContext, filter: SiteListFilter): { items: Site[]; total: number } {
    return this.sites.list(ctx, filter);
  }

  getById(ctx: TenantContext, id: string): Site {
    const site = this.sites.findById(ctx, id);
    if (!site) {
      throw Errors.notFound('Site not found');
    }
    return site;
  }

  create(
    ctx: TenantContext,
    input: { name: string; location: string },
    ip: string,
  ): Site {
    const tenantId = this.resolveWriteTenantId(ctx);
    const trimmedName = input.name.trim();
    const trimmedLocation = input.location.trim();

    const duplicate = this.sites.findByNameInTenant(ctx, tenantId, trimmedName);
    if (duplicate) {
      throw Errors.conflict(`A site named "${trimmedName}" already exists in this organization`, {
        field: 'name',
      });
    }

    const created = this.sites.create(ctx, {
      id: generateId('sit'),
      tenantId,
      name: trimmedName,
      location: trimmedLocation,
    });

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId,
      action: 'SITE_CREATED',
      targetType: 'SITE',
      targetId: created.id,
      outcome: 'SUCCESS',
      ip,
      details: { name: created.name, location: created.location },
    });

    return created;
  }

  update(
    ctx: TenantContext,
    id: string,
    patch: { name?: string; location?: string },
    ip: string,
  ): Site {
    const existing = this.sites.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Site not found');
    }

    if (patch.name !== undefined) {
      const duplicate = this.sites.findByNameInTenant(ctx, existing.tenantId, patch.name.trim());
      if (duplicate && duplicate.id !== existing.id) {
        throw Errors.conflict(
          `A site named "${patch.name.trim()}" already exists in this organization`,
          { field: 'name' },
        );
      }
    }

    const updated = this.sites.update(ctx, id, patch);
    if (!updated) {
      throw Errors.notFound('Site not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'SITE_UPDATED',
      targetType: 'SITE',
      targetId: updated.id,
      outcome: 'SUCCESS',
      ip,
      details: {
        before: { name: existing.name, location: existing.location },
        after: { name: updated.name, location: updated.location },
      },
    });

    return updated;
  }

  delete(ctx: TenantContext, id: string, ip: string): void {
    const existing = this.sites.findById(ctx, id);
    if (!existing) {
      throw Errors.notFound('Site not found');
    }

    // Section 7: delete blocked with 409 if devices exist
    const deviceCount = this.devices.countDevicesInSite(existing.id);
    if (deviceCount > 0) {
      throw Errors.conflict(
        `Cannot delete site "${existing.name}" because ${deviceCount} ${
          deviceCount === 1 ? 'device is' : 'devices are'
        } assigned to it. Reassign or remove devices first.`,
        { deviceCount },
      );
    }

    const deleted = this.sites.delete(ctx, id);
    if (!deleted) {
      throw Errors.notFound('Site not found');
    }

    this.audit.record({
      actorId: ctx.userId,
      actorRole: ctx.role,
      tenantId: existing.tenantId,
      action: 'SITE_DELETED',
      targetType: 'SITE',
      targetId: existing.id,
      outcome: 'SUCCESS',
      ip,
      details: { name: existing.name, location: existing.location },
    });
  }
}

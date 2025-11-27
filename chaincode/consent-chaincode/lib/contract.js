'use strict';

/**
 * Consent Chaincode Contract
 * 
 * Reference: https://hyperledger-fabric.readthedocs.io/en/latest/chaincode4ade.html
 * Reference: https://hyperledger.github.io/fabric-chaincode-node/main/api/
 * Reference: https://github.com/hyperledger/fabric-samples/tree/main/asset-transfer-basic/chaincode-javascript
 * 
 * This chaincode stores ONLY metadata (no PHI - Protected Health Information).
 * All actual health data is stored off-chain (IPFS) and referenced by CID.
 */

const { Contract } = require('fabric-contract-api');

// Key prefixes for composite keys
const ORG_PREFIX = 'ORG';
const RESOURCE_PREFIX = 'RESOURCE';
const ACCESS_PREFIX = 'ACCESS';
const AUDIT_PREFIX = 'AUDIT';

class ConsentContract extends Contract {

    constructor() {
        // Unique namespace for this contract
        // Reference: https://hyperledger.github.io/fabric-chaincode-node/main/api/fabric-contract-api.Contract.html
        super('ConsentContract');
    }

    /**
     * Initialize the chaincode (optional)
     * Called when chaincode is instantiated
     */
    async initLedger(ctx) {
        console.info('============= START : Initialize Ledger ===========');
        console.info('Consent chaincode initialized');
        console.info('============= END : Initialize Ledger ===========');
        return JSON.stringify({ status: 'initialized' });
    }

    /**
     * Register a new organization
     * @param {Context} ctx - Transaction context
     * @param {string} orgId - Unique organization identifier
     * @param {string} orgMeta - JSON string with organization metadata (name, type, etc.)
     * @returns {string} - JSON string with registration result
     */
    async registerOrg(ctx, orgId, orgMeta) {
        console.info('============= START : Register Organization ===========');

        // Validate inputs
        if (!orgId || orgId.trim() === '') {
            throw new Error('Organization ID is required');
        }

        let metadata;
        try {
            metadata = JSON.parse(orgMeta);
        } catch (err) {
            throw new Error('orgMeta must be valid JSON');
        }

        // Create composite key for organization
        // Reference: https://hyperledger-fabric.readthedocs.io/en/latest/chaincode4ade.html#range-queries-and-composite-keys
        const orgKey = ctx.stub.createCompositeKey(ORG_PREFIX, [orgId]);

        // Check if org already exists
        const existingOrg = await ctx.stub.getState(orgKey);
        if (existingOrg && existingOrg.length > 0) {
            throw new Error(`Organization ${orgId} already exists`);
        }

        const org = {
            docType: 'organization',
            orgId: orgId,
            metadata: metadata,
            registeredAt: ctx.stub.getTxTimestamp().seconds.low,
            txId: ctx.stub.getTxID()
        };

        await ctx.stub.putState(orgKey, Buffer.from(JSON.stringify(org)));

        console.info('============= END : Register Organization ===========');
        return JSON.stringify(org);
    }

    /**
     * Upload resource metadata (reference to off-chain data)
     * @param {Context} ctx - Transaction context
     * @param {string} resourceId - Unique resource identifier
     * @param {string} ownerOrgId - Organization that owns this resource
     * @param {string} cid - IPFS Content Identifier
     * @param {string} sha256 - SHA256 hash of the encrypted content
     * @param {string} fhirType - FHIR resource type (Patient, Observation, etc.)
     * @returns {string} - JSON string with upload result
     */
    async uploadMeta(ctx, resourceId, ownerOrgId, cid, sha256, fhirType) {
        console.info('============= START : Upload Metadata ===========');

        // Validate inputs
        if (!resourceId || resourceId.trim() === '') {
            throw new Error('Resource ID is required');
        }
        if (!ownerOrgId || ownerOrgId.trim() === '') {
            throw new Error('Owner Organization ID is required');
        }
        if (!cid || cid.trim() === '') {
            throw new Error('CID (Content Identifier) is required');
        }
        if (!sha256 || sha256.trim() === '') {
            throw new Error('SHA256 hash is required');
        }
        if (!fhirType || fhirType.trim() === '') {
            throw new Error('FHIR type is required');
        }

        // Verify owner organization exists
        const orgKey = ctx.stub.createCompositeKey(ORG_PREFIX, [ownerOrgId]);
        const orgData = await ctx.stub.getState(orgKey);
        if (!orgData || orgData.length === 0) {
            throw new Error(`Owner organization ${ownerOrgId} does not exist`);
        }

        // Create composite key for resource
        const resourceKey = ctx.stub.createCompositeKey(RESOURCE_PREFIX, [resourceId]);

        // Check if resource already exists
        const existingResource = await ctx.stub.getState(resourceKey);
        if (existingResource && existingResource.length > 0) {
            throw new Error(`Resource ${resourceId} already exists`);
        }

        const resource = {
            docType: 'resource',
            resourceId: resourceId,
            ownerOrgId: ownerOrgId,
            cid: cid,
            sha256: sha256,
            fhirType: fhirType,
            uploadedAt: ctx.stub.getTxTimestamp().seconds.low,
            txId: ctx.stub.getTxID()
        };

        await ctx.stub.putState(resourceKey, Buffer.from(JSON.stringify(resource)));

        console.info('============= END : Upload Metadata ===========');
        return JSON.stringify(resource);
    }

    /**
     * Grant access to a resource for another organization
     * @param {Context} ctx - Transaction context
     * @param {string} resourceId - Resource to grant access to
     * @param {string} granteeOrgId - Organization receiving access
     * @param {string} expiryTimestamp - Unix timestamp when access expires
     * @param {string} accessType - Type of access (read, write, etc.)
     * @returns {string} - JSON string with grant result
     */
    async grantAccess(ctx, resourceId, granteeOrgId, expiryTimestamp, accessType) {
        console.info('============= START : Grant Access ===========');

        // Validate inputs
        if (!resourceId || resourceId.trim() === '') {
            throw new Error('Resource ID is required');
        }
        if (!granteeOrgId || granteeOrgId.trim() === '') {
            throw new Error('Grantee Organization ID is required');
        }
        if (!expiryTimestamp) {
            throw new Error('Expiry timestamp is required');
        }
        if (!accessType || accessType.trim() === '') {
            throw new Error('Access type is required');
        }

        // Validate accessType
        const validAccessTypes = ['read', 'write', 'admin'];
        if (!validAccessTypes.includes(accessType.toLowerCase())) {
            throw new Error(`Invalid access type. Must be one of: ${validAccessTypes.join(', ')}`);
        }

        // Verify resource exists
        const resourceKey = ctx.stub.createCompositeKey(RESOURCE_PREFIX, [resourceId]);
        const resourceData = await ctx.stub.getState(resourceKey);
        if (!resourceData || resourceData.length === 0) {
            throw new Error(`Resource ${resourceId} does not exist`);
        }

        // Verify grantee organization exists
        const orgKey = ctx.stub.createCompositeKey(ORG_PREFIX, [granteeOrgId]);
        const orgData = await ctx.stub.getState(orgKey);
        if (!orgData || orgData.length === 0) {
            throw new Error(`Grantee organization ${granteeOrgId} does not exist`);
        }

        // Create composite key for access grant
        const accessKey = ctx.stub.createCompositeKey(ACCESS_PREFIX, [resourceId, granteeOrgId]);

        const accessGrant = {
            docType: 'accessGrant',
            resourceId: resourceId,
            granteeOrgId: granteeOrgId,
            expiryTimestamp: parseInt(expiryTimestamp, 10),
            accessType: accessType.toLowerCase(),
            grantedAt: ctx.stub.getTxTimestamp().seconds.low,
            isActive: true,
            txId: ctx.stub.getTxID()
        };

        await ctx.stub.putState(accessKey, Buffer.from(JSON.stringify(accessGrant)));

        // Emit event for grant
        // Reference: https://hyperledger-fabric.readthedocs.io/en/latest/chaincode4ade.html#chaincode-events
        const eventPayload = {
            eventType: 'AccessGranted',
            resourceId: resourceId,
            granteeOrgId: granteeOrgId,
            accessType: accessType.toLowerCase(),
            expiryTimestamp: parseInt(expiryTimestamp, 10),
            timestamp: ctx.stub.getTxTimestamp().seconds.low,
            txId: ctx.stub.getTxID()
        };
        ctx.stub.setEvent('AccessGranted', Buffer.from(JSON.stringify(eventPayload)));

        console.info('============= END : Grant Access ===========');
        return JSON.stringify(accessGrant);
    }

    /**
     * Revoke access to a resource for an organization
     * @param {Context} ctx - Transaction context
     * @param {string} resourceId - Resource to revoke access from
     * @param {string} granteeOrgId - Organization losing access
     * @returns {string} - JSON string with revoke result
     */
    async revokeAccess(ctx, resourceId, granteeOrgId) {
        console.info('============= START : Revoke Access ===========');

        // Validate inputs
        if (!resourceId || resourceId.trim() === '') {
            throw new Error('Resource ID is required');
        }
        if (!granteeOrgId || granteeOrgId.trim() === '') {
            throw new Error('Grantee Organization ID is required');
        }

        // Get existing access grant
        const accessKey = ctx.stub.createCompositeKey(ACCESS_PREFIX, [resourceId, granteeOrgId]);
        const accessData = await ctx.stub.getState(accessKey);

        if (!accessData || accessData.length === 0) {
            throw new Error(`No access grant found for organization ${granteeOrgId} on resource ${resourceId}`);
        }

        const accessGrant = JSON.parse(accessData.toString());

        if (!accessGrant.isActive) {
            throw new Error('Access grant is already revoked');
        }

        // Update access grant to revoked
        accessGrant.isActive = false;
        accessGrant.revokedAt = ctx.stub.getTxTimestamp().seconds.low;
        accessGrant.revokeTxId = ctx.stub.getTxID();

        await ctx.stub.putState(accessKey, Buffer.from(JSON.stringify(accessGrant)));

        // Emit event for revoke
        const eventPayload = {
            eventType: 'AccessRevoked',
            resourceId: resourceId,
            granteeOrgId: granteeOrgId,
            timestamp: ctx.stub.getTxTimestamp().seconds.low,
            txId: ctx.stub.getTxID()
        };
        ctx.stub.setEvent('AccessRevoked', Buffer.from(JSON.stringify(eventPayload)));

        console.info('============= END : Revoke Access ===========');
        return JSON.stringify(accessGrant);
    }

    /**
     * Log an access event to a resource
     * @param {Context} ctx - Transaction context
     * @param {string} resourceId - Resource being accessed
     * @param {string} actorOrgId - Organization performing the access
     * @param {string} action - Action being performed (view, download, etc.)
     * @param {string} timestamp - Unix timestamp of the access
     * @returns {string} - JSON string with audit log entry
     */
    async logAccess(ctx, resourceId, actorOrgId, action, timestamp) {
        console.info('============= START : Log Access ===========');

        // Validate inputs
        if (!resourceId || resourceId.trim() === '') {
            throw new Error('Resource ID is required');
        }
        if (!actorOrgId || actorOrgId.trim() === '') {
            throw new Error('Actor Organization ID is required');
        }
        if (!action || action.trim() === '') {
            throw new Error('Action is required');
        }
        if (!timestamp) {
            throw new Error('Timestamp is required');
        }

        // Verify resource exists
        const resourceKey = ctx.stub.createCompositeKey(RESOURCE_PREFIX, [resourceId]);
        const resourceData = await ctx.stub.getState(resourceKey);
        if (!resourceData || resourceData.length === 0) {
            throw new Error(`Resource ${resourceId} does not exist`);
        }

        // Verify actor organization exists
        const orgKey = ctx.stub.createCompositeKey(ORG_PREFIX, [actorOrgId]);
        const orgData = await ctx.stub.getState(orgKey);
        if (!orgData || orgData.length === 0) {
            throw new Error(`Actor organization ${actorOrgId} does not exist`);
        }

        // Generate unique audit log ID
        const auditId = `${resourceId}-${actorOrgId}-${timestamp}-${ctx.stub.getTxID().substring(0, 8)}`;
        const auditKey = ctx.stub.createCompositeKey(AUDIT_PREFIX, [resourceId, auditId]);

        const auditLog = {
            docType: 'auditLog',
            auditId: auditId,
            resourceId: resourceId,
            actorOrgId: actorOrgId,
            action: action,
            accessTimestamp: parseInt(timestamp, 10),
            loggedAt: ctx.stub.getTxTimestamp().seconds.low,
            txId: ctx.stub.getTxID()
        };

        await ctx.stub.putState(auditKey, Buffer.from(JSON.stringify(auditLog)));

        // Emit event for access log
        const eventPayload = {
            eventType: 'AccessLogged',
            resourceId: resourceId,
            actorOrgId: actorOrgId,
            action: action,
            accessTimestamp: parseInt(timestamp, 10),
            txId: ctx.stub.getTxID()
        };
        ctx.stub.setEvent('AccessLogged', Buffer.from(JSON.stringify(eventPayload)));

        console.info('============= END : Log Access ===========');
        return JSON.stringify(auditLog);
    }

    /**
     * Query a resource by ID
     * @param {Context} ctx - Transaction context
     * @param {string} resourceId - Resource ID to query
     * @returns {string} - JSON string with resource data
     */
    async queryResource(ctx, resourceId) {
        const resourceKey = ctx.stub.createCompositeKey(RESOURCE_PREFIX, [resourceId]);
        const resourceData = await ctx.stub.getState(resourceKey);

        if (!resourceData || resourceData.length === 0) {
            throw new Error(`Resource ${resourceId} does not exist`);
        }

        return resourceData.toString();
    }

    /**
     * Query an organization by ID
     * @param {Context} ctx - Transaction context
     * @param {string} orgId - Organization ID to query
     * @returns {string} - JSON string with organization data
     */
    async queryOrg(ctx, orgId) {
        const orgKey = ctx.stub.createCompositeKey(ORG_PREFIX, [orgId]);
        const orgData = await ctx.stub.getState(orgKey);

        if (!orgData || orgData.length === 0) {
            throw new Error(`Organization ${orgId} does not exist`);
        }

        return orgData.toString();
    }

    /**
     * Query access grant for a resource and grantee
     * @param {Context} ctx - Transaction context
     * @param {string} resourceId - Resource ID
     * @param {string} granteeOrgId - Grantee Organization ID
     * @returns {string} - JSON string with access grant data
     */
    async queryAccess(ctx, resourceId, granteeOrgId) {
        const accessKey = ctx.stub.createCompositeKey(ACCESS_PREFIX, [resourceId, granteeOrgId]);
        const accessData = await ctx.stub.getState(accessKey);

        if (!accessData || accessData.length === 0) {
            throw new Error(`No access grant found for organization ${granteeOrgId} on resource ${resourceId}`);
        }

        return accessData.toString();
    }

    /**
     * Check if an organization has valid (non-expired, active) access to a resource
     * @param {Context} ctx - Transaction context
     * @param {string} resourceId - Resource ID
     * @param {string} orgId - Organization ID to check
     * @returns {string} - JSON string with access check result
     */
    async checkAccess(ctx, resourceId, orgId) {
        // First check if org is the owner
        const resourceKey = ctx.stub.createCompositeKey(RESOURCE_PREFIX, [resourceId]);
        const resourceData = await ctx.stub.getState(resourceKey);

        if (!resourceData || resourceData.length === 0) {
            throw new Error(`Resource ${resourceId} does not exist`);
        }

        const resource = JSON.parse(resourceData.toString());

        if (resource.ownerOrgId === orgId) {
            return JSON.stringify({
                hasAccess: true,
                accessType: 'owner',
                isOwner: true
            });
        }

        // Check for access grant
        const accessKey = ctx.stub.createCompositeKey(ACCESS_PREFIX, [resourceId, orgId]);
        const accessData = await ctx.stub.getState(accessKey);

        if (!accessData || accessData.length === 0) {
            return JSON.stringify({
                hasAccess: false,
                reason: 'No access grant found'
            });
        }

        const accessGrant = JSON.parse(accessData.toString());

        if (!accessGrant.isActive) {
            return JSON.stringify({
                hasAccess: false,
                reason: 'Access has been revoked'
            });
        }

        const currentTime = ctx.stub.getTxTimestamp().seconds.low;
        if (accessGrant.expiryTimestamp < currentTime) {
            return JSON.stringify({
                hasAccess: false,
                reason: 'Access has expired'
            });
        }

        return JSON.stringify({
            hasAccess: true,
            accessType: accessGrant.accessType,
            expiryTimestamp: accessGrant.expiryTimestamp,
            isOwner: false
        });
    }
}

module.exports = ConsentContract;

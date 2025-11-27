'use strict';

/**
 * Unit Tests for Consent Chaincode
 * 
 * Reference: https://hyperledger-fabric.readthedocs.io/en/latest/chaincode4ade.html
 * Reference: https://github.com/hyperledger/fabric-samples/tree/main/asset-transfer-basic/chaincode-javascript
 * 
 * Uses mock ChaincodeStub context to test contract logic without a running Fabric network.
 */

const chai = require('chai');
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const { expect } = chai;
chai.use(sinonChai);

const ConsentContract = require('../lib/contract');

/**
 * Mock implementation of ChaincodeStub
 * Reference: https://hyperledger.github.io/fabric-chaincode-node/main/api/fabric-shim.ChaincodeStub.html
 */
class MockChaincodeStub {
    constructor() {
        this.state = new Map();
        this.events = [];
        this.txId = 'test-tx-id-' + Date.now();
        this.timestamp = { seconds: { low: Math.floor(Date.now() / 1000) } };
    }

    async getState(key) {
        const value = this.state.get(key);
        return value ? Buffer.from(value) : Buffer.from('');
    }

    async putState(key, value) {
        this.state.set(key, value.toString());
    }

    async deleteState(key) {
        this.state.delete(key);
    }

    createCompositeKey(objectType, attributes) {
        return `${objectType}:${attributes.join(':')}`;
    }

    splitCompositeKey(compositeKey) {
        const parts = compositeKey.split(':');
        return {
            objectType: parts[0],
            attributes: parts.slice(1)
        };
    }

    getTxID() {
        return this.txId;
    }

    getTxTimestamp() {
        return this.timestamp;
    }

    setEvent(name, payload) {
        this.events.push({ name, payload: payload.toString() });
    }

    getEvents() {
        return this.events;
    }

    clearEvents() {
        this.events = [];
    }

    setTimestamp(seconds) {
        this.timestamp = { seconds: { low: seconds } };
    }
}

/**
 * Mock implementation of Context
 * Reference: https://hyperledger.github.io/fabric-chaincode-node/main/api/fabric-contract-api.Context.html
 */
class MockContext {
    constructor() {
        this.stub = new MockChaincodeStub();
        this.clientIdentity = {
            getMSPID: () => 'Org1MSP',
            getID: () => 'test-user'
        };
    }
}

describe('ConsentContract', () => {
    let contract;
    let ctx;

    beforeEach(() => {
        contract = new ConsentContract();
        ctx = new MockContext();
    });

    describe('#initLedger', () => {
        it('should initialize the ledger successfully', async () => {
            const result = await contract.initLedger(ctx);
            const parsed = JSON.parse(result);
            expect(parsed.status).to.equal('initialized');
        });
    });

    describe('#registerOrg', () => {
        it('should register a new organization', async () => {
            const orgId = 'hospital-001';
            const orgMeta = JSON.stringify({ name: 'General Hospital', type: 'hospital' });

            const result = await contract.registerOrg(ctx, orgId, orgMeta);
            const org = JSON.parse(result);

            expect(org.docType).to.equal('organization');
            expect(org.orgId).to.equal(orgId);
            expect(org.metadata.name).to.equal('General Hospital');
            expect(org.metadata.type).to.equal('hospital');
            expect(org.txId).to.equal(ctx.stub.getTxID());
        });

        it('should throw error for empty orgId', async () => {
            try {
                await contract.registerOrg(ctx, '', '{}');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.equal('Organization ID is required');
            }
        });

        it('should throw error for invalid JSON metadata', async () => {
            try {
                await contract.registerOrg(ctx, 'org-001', 'invalid-json');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.equal('orgMeta must be valid JSON');
            }
        });

        it('should throw error for duplicate organization', async () => {
            const orgId = 'hospital-001';
            const orgMeta = JSON.stringify({ name: 'General Hospital' });

            await contract.registerOrg(ctx, orgId, orgMeta);

            try {
                await contract.registerOrg(ctx, orgId, orgMeta);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.equal(`Organization ${orgId} already exists`);
            }
        });
    });

    describe('#uploadMeta', () => {
        beforeEach(async () => {
            // Register owner organization first
            await contract.registerOrg(ctx, 'hospital-001', JSON.stringify({ name: 'General Hospital' }));
        });

        it('should upload resource metadata successfully', async () => {
            const resourceId = 'patient-record-001';
            const ownerOrgId = 'hospital-001';
            const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
            const sha256 = 'a1b2c3d4e5f6...';
            const fhirType = 'Patient';

            const result = await contract.uploadMeta(ctx, resourceId, ownerOrgId, cid, sha256, fhirType);
            const resource = JSON.parse(result);

            expect(resource.docType).to.equal('resource');
            expect(resource.resourceId).to.equal(resourceId);
            expect(resource.ownerOrgId).to.equal(ownerOrgId);
            expect(resource.cid).to.equal(cid);
            expect(resource.sha256).to.equal(sha256);
            expect(resource.fhirType).to.equal(fhirType);
        });

        it('should throw error for non-existent owner organization', async () => {
            try {
                await contract.uploadMeta(ctx, 'resource-001', 'non-existent-org', 'cid', 'sha256', 'Patient');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('does not exist');
            }
        });

        it('should throw error for missing required fields', async () => {
            try {
                await contract.uploadMeta(ctx, '', 'hospital-001', 'cid', 'sha256', 'Patient');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.equal('Resource ID is required');
            }
        });

        it('should throw error for duplicate resource', async () => {
            const resourceId = 'patient-record-001';
            await contract.uploadMeta(ctx, resourceId, 'hospital-001', 'cid1', 'sha1', 'Patient');

            try {
                await contract.uploadMeta(ctx, resourceId, 'hospital-001', 'cid2', 'sha2', 'Patient');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.equal(`Resource ${resourceId} already exists`);
            }
        });
    });

    describe('#grantAccess', () => {
        beforeEach(async () => {
            // Setup: register orgs and upload a resource
            await contract.registerOrg(ctx, 'hospital-001', JSON.stringify({ name: 'General Hospital' }));
            await contract.registerOrg(ctx, 'lab-001', JSON.stringify({ name: 'Test Lab' }));
            await contract.uploadMeta(ctx, 'patient-001', 'hospital-001', 'cid', 'sha256', 'Patient');
            ctx.stub.clearEvents();
        });

        it('should grant access and emit AccessGranted event', async () => {
            const resourceId = 'patient-001';
            const granteeOrgId = 'lab-001';
            const expiryTimestamp = String(Math.floor(Date.now() / 1000) + 86400); // +1 day
            const accessType = 'read';

            const result = await contract.grantAccess(ctx, resourceId, granteeOrgId, expiryTimestamp, accessType);
            const accessGrant = JSON.parse(result);

            expect(accessGrant.docType).to.equal('accessGrant');
            expect(accessGrant.resourceId).to.equal(resourceId);
            expect(accessGrant.granteeOrgId).to.equal(granteeOrgId);
            expect(accessGrant.accessType).to.equal(accessType);
            expect(accessGrant.isActive).to.be.true;

            // Verify event was emitted
            const events = ctx.stub.getEvents();
            expect(events).to.have.lengthOf(1);
            expect(events[0].name).to.equal('AccessGranted');

            const eventPayload = JSON.parse(events[0].payload);
            expect(eventPayload.eventType).to.equal('AccessGranted');
            expect(eventPayload.resourceId).to.equal(resourceId);
            expect(eventPayload.granteeOrgId).to.equal(granteeOrgId);
        });

        it('should throw error for invalid access type', async () => {
            try {
                await contract.grantAccess(ctx, 'patient-001', 'lab-001', '9999999999', 'invalid');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('Invalid access type');
            }
        });

        it('should throw error for non-existent resource', async () => {
            try {
                await contract.grantAccess(ctx, 'non-existent', 'lab-001', '9999999999', 'read');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('does not exist');
            }
        });

        it('should throw error for non-existent grantee organization', async () => {
            try {
                await contract.grantAccess(ctx, 'patient-001', 'non-existent-org', '9999999999', 'read');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('does not exist');
            }
        });
    });

    describe('#revokeAccess', () => {
        beforeEach(async () => {
            // Setup: register orgs, upload resource, grant access
            await contract.registerOrg(ctx, 'hospital-001', JSON.stringify({ name: 'General Hospital' }));
            await contract.registerOrg(ctx, 'lab-001', JSON.stringify({ name: 'Test Lab' }));
            await contract.uploadMeta(ctx, 'patient-001', 'hospital-001', 'cid', 'sha256', 'Patient');
            await contract.grantAccess(ctx, 'patient-001', 'lab-001', '9999999999', 'read');
            ctx.stub.clearEvents();
        });

        it('should revoke access and emit AccessRevoked event', async () => {
            const resourceId = 'patient-001';
            const granteeOrgId = 'lab-001';

            const result = await contract.revokeAccess(ctx, resourceId, granteeOrgId);
            const accessGrant = JSON.parse(result);

            expect(accessGrant.isActive).to.be.false;
            expect(accessGrant.revokedAt).to.be.a('number');

            // Verify event was emitted
            const events = ctx.stub.getEvents();
            expect(events).to.have.lengthOf(1);
            expect(events[0].name).to.equal('AccessRevoked');

            const eventPayload = JSON.parse(events[0].payload);
            expect(eventPayload.eventType).to.equal('AccessRevoked');
            expect(eventPayload.resourceId).to.equal(resourceId);
            expect(eventPayload.granteeOrgId).to.equal(granteeOrgId);
        });

        it('should throw error for non-existent access grant', async () => {
            try {
                await contract.revokeAccess(ctx, 'patient-001', 'non-existent-org');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('No access grant found');
            }
        });

        it('should throw error when revoking already revoked access', async () => {
            await contract.revokeAccess(ctx, 'patient-001', 'lab-001');

            try {
                await contract.revokeAccess(ctx, 'patient-001', 'lab-001');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.equal('Access grant is already revoked');
            }
        });
    });

    describe('#logAccess', () => {
        beforeEach(async () => {
            // Setup: register orgs and upload resource
            await contract.registerOrg(ctx, 'hospital-001', JSON.stringify({ name: 'General Hospital' }));
            await contract.registerOrg(ctx, 'lab-001', JSON.stringify({ name: 'Test Lab' }));
            await contract.uploadMeta(ctx, 'patient-001', 'hospital-001', 'cid', 'sha256', 'Patient');
            ctx.stub.clearEvents();
        });

        it('should log access and emit AccessLogged event', async () => {
            const resourceId = 'patient-001';
            const actorOrgId = 'lab-001';
            const action = 'view';
            const timestamp = String(Math.floor(Date.now() / 1000));

            const result = await contract.logAccess(ctx, resourceId, actorOrgId, action, timestamp);
            const auditLog = JSON.parse(result);

            expect(auditLog.docType).to.equal('auditLog');
            expect(auditLog.resourceId).to.equal(resourceId);
            expect(auditLog.actorOrgId).to.equal(actorOrgId);
            expect(auditLog.action).to.equal(action);

            // Verify event was emitted
            const events = ctx.stub.getEvents();
            expect(events).to.have.lengthOf(1);
            expect(events[0].name).to.equal('AccessLogged');

            const eventPayload = JSON.parse(events[0].payload);
            expect(eventPayload.eventType).to.equal('AccessLogged');
            expect(eventPayload.resourceId).to.equal(resourceId);
            expect(eventPayload.actorOrgId).to.equal(actorOrgId);
            expect(eventPayload.action).to.equal(action);
        });

        it('should throw error for non-existent resource', async () => {
            try {
                await contract.logAccess(ctx, 'non-existent', 'lab-001', 'view', '123456');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('does not exist');
            }
        });

        it('should throw error for non-existent actor organization', async () => {
            try {
                await contract.logAccess(ctx, 'patient-001', 'non-existent-org', 'view', '123456');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('does not exist');
            }
        });
    });

    describe('#queryResource', () => {
        beforeEach(async () => {
            await contract.registerOrg(ctx, 'hospital-001', JSON.stringify({ name: 'General Hospital' }));
            await contract.uploadMeta(ctx, 'patient-001', 'hospital-001', 'cid', 'sha256', 'Patient');
        });

        it('should query existing resource', async () => {
            const result = await contract.queryResource(ctx, 'patient-001');
            const resource = JSON.parse(result);

            expect(resource.resourceId).to.equal('patient-001');
            expect(resource.ownerOrgId).to.equal('hospital-001');
        });

        it('should throw error for non-existent resource', async () => {
            try {
                await contract.queryResource(ctx, 'non-existent');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('does not exist');
            }
        });
    });

    describe('#queryOrg', () => {
        beforeEach(async () => {
            await contract.registerOrg(ctx, 'hospital-001', JSON.stringify({ name: 'General Hospital' }));
        });

        it('should query existing organization', async () => {
            const result = await contract.queryOrg(ctx, 'hospital-001');
            const org = JSON.parse(result);

            expect(org.orgId).to.equal('hospital-001');
            expect(org.metadata.name).to.equal('General Hospital');
        });

        it('should throw error for non-existent organization', async () => {
            try {
                await contract.queryOrg(ctx, 'non-existent');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('does not exist');
            }
        });
    });

    describe('#checkAccess', () => {
        beforeEach(async () => {
            await contract.registerOrg(ctx, 'hospital-001', JSON.stringify({ name: 'General Hospital' }));
            await contract.registerOrg(ctx, 'lab-001', JSON.stringify({ name: 'Test Lab' }));
            await contract.uploadMeta(ctx, 'patient-001', 'hospital-001', 'cid', 'sha256', 'Patient');
        });

        it('should return owner access for resource owner', async () => {
            const result = await contract.checkAccess(ctx, 'patient-001', 'hospital-001');
            const access = JSON.parse(result);

            expect(access.hasAccess).to.be.true;
            expect(access.isOwner).to.be.true;
            expect(access.accessType).to.equal('owner');
        });

        it('should return no access for organization without grant', async () => {
            const result = await contract.checkAccess(ctx, 'patient-001', 'lab-001');
            const access = JSON.parse(result);

            expect(access.hasAccess).to.be.false;
            expect(access.reason).to.equal('No access grant found');
        });

        it('should return valid access for granted organization', async () => {
            const futureExpiry = String(Math.floor(Date.now() / 1000) + 86400); // +1 day
            await contract.grantAccess(ctx, 'patient-001', 'lab-001', futureExpiry, 'read');

            const result = await contract.checkAccess(ctx, 'patient-001', 'lab-001');
            const access = JSON.parse(result);

            expect(access.hasAccess).to.be.true;
            expect(access.isOwner).to.be.false;
            expect(access.accessType).to.equal('read');
        });

        it('should return no access for revoked grant', async () => {
            const futureExpiry = String(Math.floor(Date.now() / 1000) + 86400);
            await contract.grantAccess(ctx, 'patient-001', 'lab-001', futureExpiry, 'read');
            await contract.revokeAccess(ctx, 'patient-001', 'lab-001');

            const result = await contract.checkAccess(ctx, 'patient-001', 'lab-001');
            const access = JSON.parse(result);

            expect(access.hasAccess).to.be.false;
            expect(access.reason).to.equal('Access has been revoked');
        });

        it('should return no access for expired grant', async () => {
            const pastExpiry = String(Math.floor(Date.now() / 1000) - 86400); // -1 day (expired)
            await contract.grantAccess(ctx, 'patient-001', 'lab-001', pastExpiry, 'read');

            const result = await contract.checkAccess(ctx, 'patient-001', 'lab-001');
            const access = JSON.parse(result);

            expect(access.hasAccess).to.be.false;
            expect(access.reason).to.equal('Access has expired');
        });

        it('should normalize orgId to lowercase for consistent lookup', async () => {
            // Grant access with lowercase
            const futureExpiry = String(Math.floor(Date.now() / 1000) + 86400);
            await contract.grantAccess(ctx, 'patient-001', 'lab-001', futureExpiry, 'read');

            // Check access with uppercase - should still find the grant
            const result = await contract.checkAccess(ctx, 'patient-001', 'LAB-001');
            const access = JSON.parse(result);

            expect(access.hasAccess).to.be.true;
            expect(access.accessType).to.equal('read');
        });

        it('should normalize owner check (case-insensitive)', async () => {
            // Query with different case should still return owner access
            const result = await contract.checkAccess(ctx, 'patient-001', 'HOSPITAL-001');
            const access = JSON.parse(result);

            expect(access.hasAccess).to.be.true;
            expect(access.isOwner).to.be.true;
        });

        it('should return denied for revoked organization', async () => {
            // Revoke the organization
            await contract.revokeOrg(ctx, 'lab-001', 'Security breach', String(Date.now()));

            // Check access should return denied
            const result = await contract.checkAccess(ctx, 'patient-001', 'lab-001');
            const access = JSON.parse(result);

            expect(access.hasAccess).to.be.false;
            expect(access.status).to.equal('DENIED');
            expect(access.reason).to.include('revoked');
        });
    });

    describe('#revokeOrg', () => {
        beforeEach(async () => {
            await contract.registerOrg(ctx, 'malicious-org', JSON.stringify({ name: 'Malicious Org' }));
        });

        it('should revoke an organization and emit OrgRevoked event', async () => {
            const result = await contract.revokeOrg(ctx, 'malicious-org', 'Security breach', String(Date.now()));
            const org = JSON.parse(result);

            expect(org.isRevoked).to.be.true;
            expect(org.revocationReason).to.equal('Security breach');

            // Verify event was emitted
            const events = ctx.stub.getEvents();
            const revokeEvent = events.find(e => e.name === 'OrgRevoked');
            expect(revokeEvent).to.exist;
        });

        it('should create org record if not exists and mark as revoked', async () => {
            // Revoke an org that doesn't exist yet
            const result = await contract.revokeOrg(ctx, 'new-malicious-org', 'Suspicious activity', String(Date.now()));
            const org = JSON.parse(result);

            expect(org.isRevoked).to.be.true;
            expect(org.orgId).to.equal('new-malicious-org');
        });
    });

    describe('#reinstateOrg', () => {
        beforeEach(async () => {
            await contract.registerOrg(ctx, 'temp-revoked-org', JSON.stringify({ name: 'Temp Revoked' }));
            await contract.revokeOrg(ctx, 'temp-revoked-org', 'Temporary suspension', String(Date.now()));
        });

        it('should reinstate a revoked organization', async () => {
            const result = await contract.reinstateOrg(ctx, 'temp-revoked-org');
            const org = JSON.parse(result);

            expect(org.isRevoked).to.be.false;
            expect(org.reinstatedAt).to.be.a('number');
        });

        it('should throw error when reinstating non-revoked org', async () => {
            await contract.reinstateOrg(ctx, 'temp-revoked-org');

            try {
                await contract.reinstateOrg(ctx, 'temp-revoked-org');
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err.message).to.include('not revoked');
            }
        });
    });
});

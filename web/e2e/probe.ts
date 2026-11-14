// Read-only probe of the live deployment: config + counts + view shapes. No signing.
import { Rpc } from '../lib/rpc';
const rpc = new Rpc();
const C = process.env.REDTEAM_CONTRACT ?? 'redteam.arifnovrian.testnet';
const v = async (m: string, a: object = {}) => (await rpc.view<unknown>(C, m, a)).value;
const show = (k: string, x: unknown) => console.log(`== ${k}\n${JSON.stringify(x)}`);
show('get_config', await v('get_config'));
show('get_counts', await v('get_counts'));
show('list_jobs', await v('list_jobs', { from: 0, limit: 5 }));
show('get_bids(0)', await v('get_bids', { job_id: 0 }));
show('get_findings(0)', await v('get_findings', { job_id: 0 }));
show('list_agents', await v('list_agents', { from: 0, limit: 5 }));
show('get_policy_log', await v('get_policy_log', { from: 0, limit: 5 }));
show('check_counterparty(provider)', await v('check_counterparty', { account_id: 'provider.arifnovrian.testnet' }));
show('balance_of(client)', await v('balance_of', { account_id: 'client.arifnovrian.testnet' }));

/**
 * Commodities API Routes
 * Handles region-wide commodity price data (ore, herbs, gems, etc.)
 */

import { Env, json, err, cors } from '../index';

export function registerCommoditiesRoutes(route: Function) {
  // Get all commodities for a region with current prices
  route('GET', '/api/commodities/:region', false, async (_req: Request, env: Env, p: Record<string, string>) => {
    const region = p.region.toLowerCase();
    if (region !== 'us' && region !== 'eu') {
      return err('Invalid region. Must be us or eu', 400);
    }

    const obj = await env.R2_BUCKET.get(`commodities/${region}/current.json`);
    if (!obj) return err('No commodity data available for this region', 404);
    
    return new Response(await obj.text(), { 
      headers: { 'Content-Type': 'application/json', ...cors() } 
    });
  });

  // Get price history for a single commodity item
  route('GET', '/api/commodities/:region/item/:itemId', false, async (_req: Request, env: Env, p: Record<string, string>) => {
    const region = p.region.toLowerCase();
    if (region !== 'us' && region !== 'eu') {
      return err('Invalid region. Must be us or eu', 400);
    }

    const obj = await env.R2_BUCKET.get(`commodities/${region}/items/${p.itemId}.json`);
    if (!obj) return err('Commodity item not found', 404);
    
    return new Response(await obj.text(), { 
      headers: { 'Content-Type': 'application/json', ...cors() } 
    });
  });

  // Get commodities metadata (last update time, item count)
  route('GET', '/api/commodities/:region/meta', false, async (_req: Request, env: Env, p: Record<string, string>) => {
    const region = p.region.toLowerCase();
    if (region !== 'us' && region !== 'eu') {
      return err('Invalid region. Must be us or eu', 400);
    }

    const obj = await env.R2_BUCKET.get(`commodities/${region}/meta.json`);
    if (!obj) return err('No metadata available', 404);
    
    return new Response(await obj.text(), { 
      headers: { 'Content-Type': 'application/json', ...cors() } 
    });
  });
}

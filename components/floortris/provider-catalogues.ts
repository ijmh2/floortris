import type { Room } from './model.ts';

export type ProviderProduct = {
  variantId: string; providerId: string; productId: string; supplier: string;
  price?: { amount: number; currency: 'GBP' }; supplierUrl?: string; compatiblePackIds: string[];
};

/** Static measured demo metadata only. No stock, checkout, tracking or network
 * request is made; geometry continues to come from Floortris CATALOGUE. */
export const PROVIDER_PRODUCTS: ProviderProduct[] = [
  {variantId:'haven-single-100',providerId:'northbridge-furnishings',productId:'NB-BED-100',supplier:'Northbridge Furnishings',price:{amount:189,currency:'GBP'},supplierUrl:'https://example.com/northbridge/nb-bed-100',compatiblePackIds:['northbridge-alder-a204','civic-maple-s12']},
  {variantId:'line-desk-100',providerId:'northbridge-furnishings',productId:'NB-DESK-100',supplier:'Northbridge Furnishings',price:{amount:79,currency:'GBP'},supplierUrl:'https://example.com/northbridge/nb-desk-100',compatiblePackIds:['northbridge-alder-a204','civic-maple-s12']},
  {variantId:'nest-chair-60',providerId:'northbridge-furnishings',productId:'NB-CHAIR-60',supplier:'Northbridge Furnishings',price:{amount:59,currency:'GBP'},supplierUrl:'https://example.com/northbridge/nb-chair-60',compatiblePackIds:['northbridge-alder-a204','civic-maple-s12']},
  {variantId:'tallline-wardrobe-100',providerId:'northbridge-furnishings',productId:'NB-WARD-100',supplier:'Northbridge Furnishings',price:{amount:219,currency:'GBP'},supplierUrl:'https://example.com/northbridge/nb-ward-100',compatiblePackIds:['northbridge-alder-a204']},
  {variantId:'folio-drawers-90',providerId:'civic-living',productId:'CL-DRAWERS-90',supplier:'Civic Living',price:{amount:125,currency:'GBP'},supplierUrl:'https://example.com/civic/cl-drawers-90',compatiblePackIds:['civic-maple-s12']},
  {variantId:'nook-bedside-40',providerId:'northbridge-furnishings',productId:'NB-SIDE-40',supplier:'Northbridge Furnishings',price:{amount:42,currency:'GBP'},supplierUrl:'https://example.com/northbridge/nb-side-40',compatiblePackIds:['northbridge-alder-a204','civic-maple-s12']},
  {variantId:'line-blind-160',providerId:'civic-living',productId:'CL-BLIND-MADE',supplier:'Civic Living',compatiblePackIds:['civic-maple-s12']},
  {variantId:'halo-flush-35',providerId:'civic-living',productId:'CL-LIGHT-35',supplier:'Civic Living',compatiblePackIds:['civic-maple-s12']},
];

export const productForVariant=(variantId?:string)=>variantId?PROVIDER_PRODUCTS.find(product=>product.variantId===variantId):undefined;
export const variantApprovedForRoom=(room:Room,variantId:string)=>!room.accommodation||room.accommodation.approvedVariantIds.includes(variantId);

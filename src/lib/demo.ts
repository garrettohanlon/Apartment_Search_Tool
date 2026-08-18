/** Fabricated dataset so the interface can be exercised before a real agent run.
 *  Every value is invented. Nothing here is a real apartment. */
import type { Dataset } from './types';

export function demoData(): Dataset {

  const iso = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
  const B=[
   {id:'demo-bt',name:'DEMO Barclay Tower',address:'10 Barclay St',neighborhood:'Tribeca',hood_id:'tribeca',
    lat:40.7128,lon:-74.0083,year_built:2005,units:441,avg_sf_per_unit:1250,quality_score:88,
    ownership_type:'Rental',management:'DEMO Glenwood',program:'421-A (1-15)',benefit_status:'LIVE, phasing down',
    transit:'2/3 Park Pl, R/W Cortlandt',fit_seed:90,contact:{name:'DEMO leasing',phone:'000-000-0000',verified:false},
    amenities:{doorman:true,concierge:true,elevator:true,gym:true,roof_deck:true,package_room:true,parking:true,pets:true,laundry_in_unit:true,central_air:true},
    stabilization_note:'DEMO. Under 421-a (1-15) all rental units are stabilized for the benefit term.'},
   {id:'demo-lt',name:'DEMO London Terrace Gardens',address:'435 W 23rd St',neighborhood:'Chelsea',hood_id:'chelsea',
    lat:40.7466,lon:-74.0009,year_built:1934,year_renovated:2016,units:964,avg_sf_per_unit:945,quality_score:76,
    ownership_type:'Rental',management:'DEMO Rose Associates',program:'Pre-1974 + J-51',benefit_status:'Pre-1974, permanent',
    transit:'C/E 23rd St',fit_seed:88,contact:{name:'DEMO management LLC',phone:null,verified:false},
    amenities:{doorman:true,elevator:true,gym:true,package_room:true,pets:true,laundry_in_unit:false,central_air:false}},
   {id:'demo-ues',name:'DEMO Lenox Hill tower',address:'200 E 72nd St',neighborhood:'Lenox Hill (UES)',hood_id:'lenox-hill',
    lat:40.7690,lon:-73.9600,year_built:2019,units:180,avg_sf_per_unit:1100,quality_score:91,
    ownership_type:'Rental',program:'421-A (16)',benefit_status:'LIVE',transit:'Q 72nd St, 6 68th St',fit_seed:74,
    amenities:{doorman:true,concierge:true,elevator:true,gym:true,roof_deck:true,package_room:true,parking:true,pets:true,laundry_in_unit:true,central_air:true}},
  ];
  const base={availability_status:'available',lease_months:12,fee:'none',fee_paid_by:'landlord',photos:[]};
  return {date:new Date().toISOString().slice(0,10),demo:true,
   coverage:{sources_blocked:[],buildings_searched:3,notes:'Fabricated demo dataset.'},
   discoveries:[{kind:'Potential hidden gem',text:'DEMO. A management company has a renovated 2BR available through its own leasing portal that does not appear on StreetEasy.',listing_id:'d1'}],
   off_market_buildings:[{id:'demo-lt',name:'DEMO London Terrace Gardens',address:'435 W 23rd St',
     neighborhood:'Chelsea',year_built:1934,units:964,program:'Pre-1974 + J-51',fit_seed:88,
     why_stabilized:'DEMO. Pre-1974 with a J-51 class action that re-regulated units. No expiration risk.',
     contact:{name:'DEMO management office',phone:null,verified:false},
     availability_source:'management office phone enquiry',last_checked:new Date().toISOString().slice(0,10)}],
   buildings:B,
   listings:[
    {...base,id:'d1',building_id:'demo-bt',building_name:'DEMO Barclay Tower',address:'10 Barclay St',unit:'42C',
     neighborhood:'Tribeca',hood_id:'tribeca',lat:40.7128,lon:-74.0083,rent:8250,months_free:1,
     concessions_text:'1 month free on 13 months',beds:2,baths:2,sf:1284,sf_source:'published',
     est_market_rent:9100,discount_pct:9,comps_count:4,floor:42,light_score:88,views_score:85,ceiling_ft:9.5,
     condition:'Renovated 2021',condition_score:84,kitchen_score:82,bathroom_score:80,
     amenities:{laundry_in_unit:true,central_air:true,outdoor_space:false},
     available_date:'2026-10-01',lease_terms:'12 or 24 months',listed_date:iso(0),days_on_market:0,
     last_verified:new Date().toISOString(),listing_grade:'unit_verified',
     cross_check:{status:'confirmed',sources_confirming:['DEMO source A','DEMO source B']},
     source:'DEMO',value_score:86,
     comparables:[{address:'DEMO 101 Warren St',rent:8900,sf:1250},{address:'DEMO 200 Chambers',rent:9400,sf:1310}],
     stabilization:{class:'highly_likely',reasons:[
       'DEMO. Building carries a live 421-a (1-15) exemption on the current DOF roll.',
       'Under 421-a (1-15) every rental unit is stabilized for the benefit term regardless of rent.',
       'Not confirmed at unit level; DHCR registration history required.']},
     components:{location:95,size:96,price:72,building_quality:88,apartment_quality:84,stabilization:82,amenities:90,value:86},
     why_matches:'DEMO. A 1,284 sq ft two-bedroom clearing your 1,200 target, in a building whose 421-a exemption is still live, at roughly 9 percent under estimated market with a month free.',
     tradeoffs:'DEMO. The exemption is phasing down, so confirm the expiration year before signing a long lease.',
     value_reasons:'DEMO. $6.43/sf against a $7.09/sf set of four renovated Tribeca two-bedrooms.'},
    {...base,id:'d2',building_id:'demo-lt',building_name:'DEMO London Terrace Gardens',address:'435 W 23rd St',unit:'8H',
     neighborhood:'Chelsea',hood_id:'chelsea',lat:40.7466,lon:-74.0009,rent:6450,beds:2,baths:2,sf:null,
     est_market_rent:7100,discount_pct:9,comps_count:6,floor:8,light_score:72,condition:'Renovated prewar',condition_score:70,
     amenities:{laundry_in_unit:false,central_air:false},available_date:'2026-09-15',listed_date:iso(1),
     days_on_market:1,last_verified:iso(1),listing_grade:'unit_verified',
     cross_check:{status:'confirmed',sources_confirming:['DEMO source A']},source:'DEMO',value_score:78,
     stabilization:{class:'confirmed',reasons:[
       'DEMO. Pre-1974 building on the DHCR registration list.',
       'A J-51 class action re-regulated units at this address.',
       'Post-HSTPA there is no vacancy deregulation, so a regulated unit stays regulated.']},
     components:{location:95,size:60,price:88,building_quality:76,apartment_quality:70,stabilization:100,amenities:55,value:78},
     why_matches:'DEMO. Confirmed stabilized prewar two-bedroom in prime Chelsea with no expiration risk at all.',
     tradeoffs:'DEMO. Size is not published and this line may fall under 1,200 sq ft. No in-unit laundry, no central air.'},
    {...base,id:'d3',building_id:'demo-ues',building_name:'DEMO Lenox Hill tower',address:'200 E 72nd St',unit:'27B',
     neighborhood:'Lenox Hill (UES)',hood_id:'lenox-hill',lat:40.7690,lon:-73.9600,rent:8900,beds:2,baths:2,sf:1210,
     sf_source:'published',est_market_rent:8800,discount_pct:-1,comps_count:11,floor:27,light_score:92,views_score:90,
     ceiling_ft:10,condition:'New construction 2019',condition_score:95,kitchen_score:94,bathroom_score:93,
     amenities:{laundry_in_unit:true,central_air:true,outdoor_space:true},available_date:'2026-09-01',
     listed_date:iso(4),days_on_market:4,last_verified:iso(4),listing_grade:'unit_verified',
     cross_check:{status:'confirmed',sources_confirming:['DEMO source A']},source:'DEMO',value_score:58,
     stabilization:{class:'market',reasons:[
       'DEMO. 421-a(16) building.',
       'Under 421-a(16) high-rent market units are permanently exempt from stabilization.',
       'Only the income-restricted set-aside units are regulated, and you are over income for those.']},
     components:{location:80,size:92,price:40,building_quality:91,apartment_quality:95,stabilization:18,amenities:95,value:58},
     why_matches:'DEMO. The best physical apartment here: new construction, 10 ft ceilings, private outdoor space.',
     tradeoffs:'DEMO. Market rate with no stabilization path, priced at market, and at $8,900 it needs roughly $356,000 of income at 40x.'},
   ]};
}

require('dotenv').config();
const axios   = require('axios');
const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const csv     = require('csv-parse/sync');

const app  = express();
app.use(cors());
app.use(express.json());

const AI_KEY = process.env.FEATHERLESS_KEY
  ? `Bearer ${process.env.FEATHERLESS_KEY}`
  : "Bearer rc_30c5e9a206670f7f4ba1fd6c9a61c2db7900ea9c7867013b9eaea0a4104bd785";
const AI_URL = "https://api.featherless.ai/v1/chat/completions";
const MODEL  = "mistralai/Mistral-7B-Instruct-v0.2";
const PORT   = process.env.PORT || 5000;

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH NORMALIZER
// ─────────────────────────────────────────────────────────────────────────────
function branchKey(progName) {
  const p = progName.toLowerCase();
  if (p.includes('computer science') || p.includes('data science') ||
      p.includes('artificial intelligence') || p.includes('computing')) return 'CSE';
  if (p.includes('information technology') && !p.includes('bio'))        return 'IT';
  if (p.includes('electronics') || p.includes('electrical and electronics')) return 'ECE';
  if (p.includes('electrical engineering') && !p.includes('electronics'))return 'EE';
  if (p.includes('mechanical'))  return 'ME';
  if (p.includes('civil'))       return 'CE';
  if (p.includes('chemical'))    return 'Chemical';
  if (p.includes('aerospace') || p.includes('aeronautical')) return 'Aerospace';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD & PROCESS CSV AT STARTUP
// Round 6, OPEN, Gender-Neutral.
// IITs -> Quota=AI  |  NITs/IIITs -> Quota=OS
// Weighted average 2021-2025 (recent years weighted more).
// ─────────────────────────────────────────────────────────────────────────────
const YEAR_WEIGHTS = { 2021:1, 2022:1, 2023:2, 2024:3, 2025:4 };

function loadCutoffData(csvPath) {
  console.log('Loading JoSAA cutoff data from CSV...');
  const raw     = fs.readFileSync(csvPath, 'utf8');
  const records = csv.parse(raw, { columns:true, skip_empty_lines:true, trim:true });
  const acc     = {};

  for (const r of records) {
    const inst     = r['Institute']?.trim();
    const prog     = r['Academic Program Name']?.trim();
    const quota    = r['Quota']?.trim();
    const seatType = r['Seat Type']?.trim();
    const gender   = r['Gender']?.trim();
    const round    = r['Round']?.trim();
    const closing  = parseFloat(r['Closing Rank']);
    const year     = parseInt(r['Year']);

    if (!inst || !prog || !closing || isNaN(closing) || isNaN(year)) continue;
    if (seatType !== 'OPEN')             continue;
    if (gender   !== 'Gender-Neutral')   continue;
    if (round !== '6' && round !== '7')  continue;

    const isIIT = inst.includes('Indian Institute of Technology');
    if (isIIT  && quota !== 'AI') continue;
    if (!isIIT && quota !== 'OS') continue;

    const branch = branchKey(prog);
    if (!branch) continue;
    const w = YEAR_WEIGHTS[year];
    if (!w) continue;

    if (!acc[inst])          acc[inst]          = {};
    if (!acc[inst][branch])  acc[inst][branch]  = { totalW:0, totalRank:0 };
    acc[inst][branch].totalW    += w;
    acc[inst][branch].totalRank += closing * w;
  }

  const result = {};
  for (const [inst, branches] of Object.entries(acc)) {
    const bMap = {};
    for (const [branch, { totalW, totalRank }] of Object.entries(branches)) {
      if (totalW >= 2) bMap[branch] = Math.round(totalRank / totalW);
    }
    if (Object.keys(bMap).length) result[inst] = bMap;
  }
  console.log(`Loaded cutoffs for ${Object.keys(result).length} institutes`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTITUTE METADATA
// ─────────────────────────────────────────────────────────────────────────────
const INST_META = {
  'Indian Institute of Technology Bombay':    {fees:220000,state:'Maharashtra',       nirf:3, avgPkg:28,highPkg:120,rating:9.8,placement:10,research:10,infra:10,tags:['IIT','Premium','Research']},
  'Indian Institute of Technology Delhi':     {fees:220000,state:'Delhi',             nirf:2, avgPkg:27,highPkg:110,rating:9.8,placement:10,research:10,infra:10,tags:['IIT','Premium','Research']},
  'Indian Institute of Technology Madras':    {fees:200000,state:'Tamil Nadu',        nirf:1, avgPkg:25,highPkg:105,rating:9.7,placement:10,research:10,infra:10,tags:['IIT','Premium','Research']},
  'Indian Institute of Technology Kanpur':    {fees:200000,state:'Uttar Pradesh',     nirf:4, avgPkg:24,highPkg:100,rating:9.6,placement:10,research:10,infra:9, tags:['IIT','Premium','Research']},
  'Indian Institute of Technology Kharagpur': {fees:180000,state:'West Bengal',       nirf:5, avgPkg:22,highPkg:95, rating:9.5,placement:9, research:10,infra:9, tags:['IIT','Premium','Research']},
  'Indian Institute of Technology Roorkee':   {fees:190000,state:'Uttarakhand',       nirf:6, avgPkg:20,highPkg:85, rating:9.4,placement:9, research:9, infra:9, tags:['IIT','Premium']},
  'Indian Institute of Technology Guwahati':  {fees:175000,state:'Assam',             nirf:7, avgPkg:17,highPkg:70, rating:9.1,placement:8, research:9, infra:8, tags:['IIT','Premium']},
  'Indian Institute of Technology Hyderabad': {fees:175000,state:'Telangana',         nirf:8, avgPkg:18,highPkg:75, rating:9.2,placement:9, research:9, infra:8, tags:['IIT','Premium']},
  'Indian Institute of Technology Gandhinagar':{fees:175000,state:'Gujarat',          nirf:11,avgPkg:16,highPkg:65, rating:9.0,placement:8, research:9, infra:8, tags:['IIT']},
  'Indian Institute of Technology Indore':    {fees:165000,state:'Madhya Pradesh',    nirf:14,avgPkg:14,highPkg:55, rating:8.8,placement:8, research:8, infra:8, tags:['IIT']},
  'Indian Institute of Technology (BHU) Varanasi':{fees:165000,state:'Uttar Pradesh', nirf:12,avgPkg:15,highPkg:60, rating:8.9,placement:8, research:8, infra:8, tags:['IIT']},
  'Indian Institute  of Technology (BHU) Varanasi':{fees:165000,state:'Uttar Pradesh',nirf:12,avgPkg:15,highPkg:60, rating:8.9,placement:8, research:8, infra:8, tags:['IIT']},
  'Indian Institute of Technology (ISM) Dhanbad':{fees:160000,state:'Jharkhand',     nirf:18,avgPkg:13,highPkg:50, rating:8.6,placement:7, research:8, infra:7, tags:['IIT']},
  'Indian Institute  of Technology (ISM) Dhanbad':{fees:160000,state:'Jharkhand',    nirf:18,avgPkg:13,highPkg:50, rating:8.6,placement:7, research:8, infra:7, tags:['IIT']},
  'Indian Institute of Technology Patna':     {fees:160000,state:'Bihar',             nirf:19,avgPkg:12,highPkg:45, rating:8.5,placement:7, research:7, infra:7, tags:['IIT']},
  'Indian Institute of Technology Jodhpur':   {fees:160000,state:'Rajasthan',         nirf:20,avgPkg:12,highPkg:42, rating:8.4,placement:7, research:7, infra:7, tags:['IIT']},
  'Indian Institute of Technology Mandi':     {fees:155000,state:'Himachal Pradesh',  nirf:21,avgPkg:11,highPkg:40, rating:8.3,placement:7, research:7, infra:7, tags:['IIT']},
  'Indian Institute of Technology Ropar':     {fees:155000,state:'Punjab',            nirf:23,avgPkg:11,highPkg:40, rating:8.2,placement:7, research:7, infra:7, tags:['IIT']},
  'Indian Institute of Technology Bhubaneswar':{fees:155000,state:'Odisha',           nirf:22,avgPkg:11,highPkg:38, rating:8.2,placement:7, research:7, infra:7, tags:['IIT']},
  'Indian Institute of Technology Bhilai':    {fees:150000,state:'Chhattisgarh',      nirf:null,avgPkg:10,highPkg:35,rating:7.9,placement:6,research:6,infra:6,tags:['IIT']},
  'Indian Institute of Technology Goa':       {fees:150000,state:'Goa',               nirf:null,avgPkg:10,highPkg:35,rating:7.9,placement:6,research:6,infra:6,tags:['IIT']},
  'Indian Institute of Technology Tirupati':  {fees:150000,state:'Andhra Pradesh',    nirf:null,avgPkg:10,highPkg:35,rating:7.8,placement:6,research:6,infra:6,tags:['IIT']},
  'Indian Institute of Technology Dharwad':   {fees:150000,state:'Karnataka',         nirf:null,avgPkg:10,highPkg:35,rating:7.8,placement:6,research:6,infra:6,tags:['IIT']},
  'Indian Institute of Technology Jammu':     {fees:150000,state:'Jammu & Kashmir',   nirf:null,avgPkg:9, highPkg:32, rating:7.7,placement:6,research:6,infra:6,tags:['IIT']},
  'Indian Institute of Technology Palakkad':  {fees:150000,state:'Kerala',            nirf:null,avgPkg:9, highPkg:32, rating:7.7,placement:6,research:6,infra:6,tags:['IIT']},
  'National Institute of Technology, Tiruchirappalli':{fees:150000,state:'Tamil Nadu', nirf:9, avgPkg:14,highPkg:55,rating:8.8,placement:9,research:7,infra:8,tags:['NIT','Government']},
  'National Institute of Technology, Warangal':{fees:145000,state:'Telangana',        nirf:10,avgPkg:13,highPkg:50,rating:8.7,placement:9,research:7,infra:8,tags:['NIT','Government']},
  'National Institute of Technology Karnataka, Surathkal':{fees:140000,state:'Karnataka',nirf:13,avgPkg:12,highPkg:48,rating:8.6,placement:8,research:7,infra:8,tags:['NIT','Government']},
  'National Institute of Technology Calicut': {fees:135000,state:'Kerala',            nirf:15,avgPkg:12,highPkg:45,rating:8.5,placement:8,research:6,infra:7,tags:['NIT','Government']},
  'National Institute of Technology, Rourkela':{fees:130000,state:'Odisha',           nirf:16,avgPkg:11,highPkg:42,rating:8.4,placement:8,research:6,infra:7,tags:['NIT','Government']},
  'Malaviya National Institute of Technology Jaipur':{fees:132000,state:'Rajasthan',  nirf:20,avgPkg:10,highPkg:40,rating:8.3,placement:8,research:5,infra:7,tags:['NIT','Government']},
  'Motilal Nehru National Institute of Technology Allahabad':{fees:132000,state:'Uttar Pradesh',nirf:21,avgPkg:10,highPkg:38,rating:8.3,placement:7,research:5,infra:7,tags:['NIT','Government']},
  'Visvesvaraya National Institute of Technology, Nagpur':{fees:128000,state:'Maharashtra',nirf:22,avgPkg:10,highPkg:38,rating:8.2,placement:7,research:5,infra:7,tags:['NIT','Government']},
  'National Institute of Technology Durgapur':{fees:125000,state:'West Bengal',       nirf:26,avgPkg:9, highPkg:35,rating:8.0,placement:7,research:5,infra:7,tags:['NIT','Government']},
  'National Institute of Technology, Kurukshetra':{fees:130000,state:'Haryana',       nirf:24,avgPkg:10,highPkg:38,rating:8.2,placement:7,research:5,infra:7,tags:['NIT','Government']},
  'Sardar Vallabhbhai National Institute of Technology, Surat':{fees:128000,state:'Gujarat',nirf:25,avgPkg:9,highPkg:36,rating:8.1,placement:7,research:5,infra:7,tags:['NIT','Government']},
  'Maulana Azad National Institute of Technology Bhopal':{fees:125000,state:'Madhya Pradesh',nirf:27,avgPkg:9,highPkg:34,rating:8.0,placement:7,research:5,infra:7,tags:['NIT','Government']},
  'National Institute of Technology, Jamshedpur':{fees:120000,state:'Jharkhand',      nirf:28,avgPkg:8, highPkg:32,rating:7.9,placement:7,research:4,infra:7,tags:['NIT','Government']},
  'National Institute of Technology, Andhra Pradesh':{fees:120000,state:'Andhra Pradesh',nirf:null,avgPkg:8,highPkg:30,rating:7.8,placement:7,research:4,infra:7,tags:['NIT','Government']},
  'National Institute of Technology Patna':    {fees:115000,state:'Bihar',             nirf:null,avgPkg:7,highPkg:28,rating:7.6,placement:6,research:4,infra:6,tags:['NIT','Government']},
  'National Institute of Technology Raipur':   {fees:115000,state:'Chhattisgarh',     nirf:null,avgPkg:7,highPkg:28,rating:7.5,placement:6,research:4,infra:6,tags:['NIT','Government']},
  'Dr. B R Ambedkar National Institute of Technology, Jalandhar':{fees:118000,state:'Punjab',nirf:29,avgPkg:8,highPkg:30,rating:7.7,placement:6,research:4,infra:6,tags:['NIT','Government']},
  'National Institute of Technology Hamirpur': {fees:115000,state:'Himachal Pradesh', nirf:null,avgPkg:7,highPkg:26,rating:7.5,placement:6,research:4,infra:6,tags:['NIT','Government']},
  'National Institute of Technology Delhi':    {fees:120000,state:'Delhi',             nirf:null,avgPkg:8,highPkg:30,rating:7.7,placement:7,research:4,infra:7,tags:['NIT','Government']},
  'National Institute of Technology Goa':      {fees:112000,state:'Goa',               nirf:null,avgPkg:7,highPkg:26,rating:7.4,placement:6,research:4,infra:6,tags:['NIT','Government']},
  'National Institute of Technology, Srinagar':{fees:110000,state:'Jammu & Kashmir',  nirf:null,avgPkg:6,highPkg:22,rating:7.2,placement:5,research:3,infra:6,tags:['NIT','Government']},
  'National Institute of Technology  Agartala':{fees:108000,state:'Tripura',           nirf:null,avgPkg:6,highPkg:20,rating:7.1,placement:5,research:3,infra:6,tags:['NIT','Government']},
  'National Institute of Technology Agartala': {fees:108000,state:'Tripura',           nirf:null,avgPkg:6,highPkg:20,rating:7.1,placement:5,research:3,infra:6,tags:['NIT','Government']},
  'National Institute of Technology, Uttarakhand':{fees:108000,state:'Uttarakhand',   nirf:null,avgPkg:6,highPkg:20,rating:7.0,placement:5,research:3,infra:6,tags:['NIT','Government']},
  'National Institute of Technology Meghalaya':{fees:105000,state:'Meghalaya',         nirf:null,avgPkg:5,highPkg:18,rating:6.8,placement:5,research:3,infra:6,tags:['NIT','Government']},
  'National Institute of Technology Sikkim':   {fees:103000,state:'Sikkim',            nirf:null,avgPkg:5,highPkg:16,rating:6.6,placement:4,research:2,infra:5,tags:['NIT','Government']},
  'National Institute of Technology Puducherry':{fees:103000,state:'Puducherry',       nirf:null,avgPkg:5,highPkg:16,rating:6.6,placement:4,research:2,infra:5,tags:['NIT','Government']},
  'National Institute of Technology Nagaland': {fees:100000,state:'Nagaland',          nirf:null,avgPkg:4,highPkg:14,rating:6.4,placement:4,research:2,infra:5,tags:['NIT','Government']},
  'National Institute of Technology, Mizoram': {fees:100000,state:'Mizoram',           nirf:null,avgPkg:4,highPkg:14,rating:6.3,placement:4,research:2,infra:5,tags:['NIT','Government']},
  'National Institute of Technology, Manipur': {fees:100000,state:'Manipur',           nirf:null,avgPkg:4,highPkg:14,rating:6.3,placement:4,research:2,infra:5,tags:['NIT','Government']},
  'National Institute of Technology Arunachal Pradesh':{fees:100000,state:'Arunachal Pradesh',nirf:null,avgPkg:4,highPkg:14,rating:6.2,placement:4,research:2,infra:5,tags:['NIT','Government']},
  'National Institute of Technology, Silchar': {fees:108000,state:'Assam',             nirf:null,avgPkg:6,highPkg:20,rating:7.0,placement:5,research:3,infra:6,tags:['NIT','Government']},
};

// ─────────────────────────────────────────────────────────────────────────────
// BUILD JEE POOL FROM CSV DATA + METADATA
// ─────────────────────────────────────────────────────────────────────────────
const CSV_PATH    = path.join(__dirname, 'merged_jee_cutoff_2018_2025.csv');
const CUTOFF_DATA = loadCutoffData(CSV_PATH);

const JEE_COLLEGES = Object.entries(CUTOFF_DATA)
  .map(([name, branches]) => {
    const meta = INST_META[name];
    if (!meta) return null;
    const isIIT = name.includes('Indian Institute of Technology');
    return { name, branches, requiresAdvanced:isIIT, ...meta };
  })
  .filter(Boolean);

console.log(`JEE college pool ready: ${JEE_COLLEGES.length} institutes`);

// ─────────────────────────────────────────────────────────────────────────────
// EAMCET COLLEGES (static)
// ─────────────────────────────────────────────────────────────────────────────
const EAMCET_COLLEGES = {
  TS: [
    { name:'JNTU Hyderabad',           cutoff:2000,  fees:55000,  state:'Telangana', baseProb:12, nirf:null, avgPkg:8,  highPkg:38, rating:8.0, placement:7,research:6,infra:7,tags:['Government','Hyderabad'] },
    { name:'Osmania University',        cutoff:3000,  fees:50000,  state:'Telangana', baseProb:18, nirf:null, avgPkg:7,  highPkg:32, rating:7.8, placement:7,research:5,infra:7,tags:['Government','Hyderabad'] },
    { name:'NIT Warangal',             cutoff:1500,  fees:145000, state:'Telangana', baseProb:10, nirf:10,   avgPkg:13, highPkg:50, rating:8.7, placement:9,research:7,infra:8,tags:['NIT','Government'] },
    { name:'IIIT Hyderabad',           cutoff:2500,  fees:300000, state:'Telangana', baseProb:16, nirf:30,   avgPkg:22, highPkg:90, rating:9.1, placement:10,research:9,infra:8,tags:['IIIT','AI','Premium'] },
    { name:'BITS Hyderabad',           cutoff:6000,  fees:510000, state:'Telangana', baseProb:38, nirf:29,   avgPkg:17, highPkg:68, rating:8.8, placement:9,research:7,infra:9,tags:['BITS','Industry'] },
    { name:'CBIT Hyderabad',           cutoff:8000,  fees:90000,  state:'Telangana', baseProb:42, nirf:null, avgPkg:7,  highPkg:30, rating:7.6, placement:7,research:4,infra:7,tags:['Private','Hyderabad'] },
    { name:'Vasavi College',            cutoff:10000, fees:85000,  state:'Telangana', baseProb:40, nirf:null, avgPkg:6,  highPkg:28, rating:7.4, placement:7,research:3,infra:7,tags:['Private','Hyderabad'] },
    { name:'VNR VJIET',                cutoff:12000, fees:80000,  state:'Telangana', baseProb:45, nirf:null, avgPkg:6,  highPkg:26, rating:7.3, placement:7,research:3,infra:7,tags:['Private','Hyderabad'] },
    { name:'BVRIT Hyderabad',          cutoff:15000, fees:75000,  state:'Telangana', baseProb:50, nirf:null, avgPkg:5,  highPkg:22, rating:7.0, placement:6,research:3,infra:7,tags:['Private','Hyderabad'] },
    { name:'CVR College',              cutoff:18000, fees:70000,  state:'Telangana', baseProb:52, nirf:null, avgPkg:5,  highPkg:20, rating:6.9, placement:6,research:3,infra:6,tags:['Private','Hyderabad'] },
    { name:'GRIET Hyderabad',          cutoff:20000, fees:72000,  state:'Telangana', baseProb:55, nirf:null, avgPkg:5,  highPkg:20, rating:6.8, placement:6,research:3,infra:6,tags:['Private','Hyderabad'] },
    { name:'MVSR Engineering College', cutoff:25000, fees:65000,  state:'Telangana', baseProb:70, nirf:null, avgPkg:4,  highPkg:16, rating:6.5, placement:6,research:2,infra:6,tags:['Private','Hyderabad','Affordable'] },
    { name:'SR Engineering College',   cutoff:30000, fees:65000,  state:'Telangana', baseProb:72, nirf:null, avgPkg:4,  highPkg:15, rating:6.3, placement:5,research:2,infra:6,tags:['Private','Affordable'] },
    { name:'Malla Reddy Engineering',  cutoff:40000, fees:60000,  state:'Telangana', baseProb:78, nirf:null, avgPkg:3,  highPkg:12, rating:6.0, placement:5,research:2,infra:6,tags:['Private','Affordable'] },
    { name:'CMR College',              cutoff:50000, fees:58000,  state:'Telangana', baseProb:82, nirf:null, avgPkg:3,  highPkg:11, rating:5.8, placement:5,research:2,infra:6,tags:['Private','Affordable'] },
    { name:'Gokaraju Rangaraju (GRIET)',cutoff:22000, fees:68000, state:'Telangana', baseProb:65, nirf:null, avgPkg:4,  highPkg:15, rating:6.6, placement:6,research:2,infra:6,tags:['Private','Hyderabad'] },
  ],
  AP: [
    { name:'JNTU Kakinada',            cutoff:2000,  fees:55000,  state:'Andhra Pradesh', baseProb:14, nirf:null, avgPkg:7,  highPkg:30, rating:7.6, placement:7,research:5,infra:7,tags:['Government'] },
    { name:'AU Visakhapatnam',          cutoff:3000,  fees:50000,  state:'Andhra Pradesh', baseProb:18, nirf:null, avgPkg:6,  highPkg:28, rating:7.4, placement:6,research:5,infra:6,tags:['Government'] },
    { name:'NIT AP',                   cutoff:4000,  fees:140000, state:'Andhra Pradesh', baseProb:22, nirf:null, avgPkg:11, highPkg:45, rating:8.2, placement:8,research:6,infra:7,tags:['NIT','Government'] },
    { name:'GITAM Visakhapatnam',      cutoff:15000, fees:150000, state:'Andhra Pradesh', baseProb:48, nirf:55,   avgPkg:7,  highPkg:30, rating:7.5, placement:7,research:4,infra:8,tags:['Private','Industry'] },
    { name:'VIT AP',                   cutoff:20000, fees:200000, state:'Andhra Pradesh', baseProb:52, nirf:60,   avgPkg:7,  highPkg:35, rating:7.5, placement:7,research:4,infra:8,tags:['Private','Industry'] },
    { name:'KL University',            cutoff:80000, fees:180000, state:'Andhra Pradesh', baseProb:80, nirf:45,   avgPkg:6,  highPkg:28, rating:7.3, placement:7,research:4,infra:8,tags:['Private','Industry'] },
    { name:'SRM AP',                   cutoff:100000,fees:200000, state:'Andhra Pradesh', baseProb:83, nirf:null, avgPkg:6,  highPkg:25, rating:7.0, placement:7,research:3,infra:8,tags:['Private'] },
    { name:"Vignan's University AP",   cutoff:50000, fees:90000,  state:'Andhra Pradesh', baseProb:75, nirf:null, avgPkg:4,  highPkg:16, rating:6.5, placement:5,research:3,infra:7,tags:['Private','Affordable'] },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PROBABILITY ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const ADV_QUALIFIER_CUTOFF = 250000;

function calcProbJEE(rank, college, branch) {
  const cutoff = college.branches[branch] || college.branches['CSE'];
  if (!cutoff) return 0;
  const r = rank / cutoff;
  if (r > 1.12) return 0;
  if (r > 1.06) return 8;
  if (r > 1.0)  return 18;
  if (r > 0.9)  return 55;
  if (r > 0.75) return 72;
  if (r > 0.5)  return 85;
  return 93;
}

function calcProbEAMCET(rank, cutoff, baseProb) {
  const r = rank / cutoff;
  if (r > 1.12) return 0;
  if (r > 1.0)  return Math.max(Math.round(baseProb * 0.3), 8);
  if (r > 0.85) return Math.min(baseProb, 75);
  if (r > 0.6)  return Math.min(baseProb + 10, 85);
  return Math.min(baseProb + 20, 93);
}

function assignCategory(prob) {
  if (prob >= 60) return 'safe';
  if (prob >= 28) return 'moderate';
  return 'dream';
}

function qualityScore(c, w) {
  const feesScore = Math.max(0, 10 - (c.fees / 200000));
  const total = (w.placement||0)+(w.research||0)+(w.infra||0)+(w.affordable||0);
  if (!total) return c.rating;
  return (c.placement*(w.placement||0)+c.research*(w.research||0)+c.infra*(w.infra||0)+feesScore*(w.affordable||0))/total;
}

// ─────────────────────────────────────────────────────────────────────────────
const INDEX = {
  jee:       [...JEE_COLLEGES],
  eamcet_ts: [...EAMCET_COLLEGES.TS],
  eamcet_ap: [...EAMCET_COLLEGES.AP],
};

const responseCache = new Map();
const CACHE_MAX = 200;

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.send('Server running'));
app.get('/ping', (_req, res) => res.json({ ok:true, model:MODEL, jeeColleges:JEE_COLLEGES.length }));

app.get('/chat-test', async (_req, res) => {
  try {
    const r = await axios.post(AI_URL,
      { model:MODEL, max_tokens:30, messages:[{role:'user',content:'Say "API working" and nothing else.'}] },
      { headers:{Authorization:AI_KEY,'Content-Type':'application/json'}, timeout:10000 }
    );
    res.json({ ok:true, reply:r.data?.choices?.[0]?.message?.content });
  } catch(e) {
    res.json({ ok:false, status:e.response?.status, error:e.response?.data||e.message });
  }
});

// ── PREDICT ──────────────────────────────────────────────────────────────────
app.post('/predict', async (req, res) => {
  const { name, rank, branch, budget, examType, states, priorities } = req.body;
  const weights        = priorities || { placement:2, research:1, infra:1, affordable:0 };
  const selectedBranch = branch || 'CSE';

  const cacheKey = JSON.stringify({ rank, branch:selectedBranch, budget, examType, states:states||null, weights });
  if (responseCache.has(cacheKey)) return res.json(responseCache.get(cacheKey));

  let results = [];

  if (examType === 'eamcet') {
    let pool = [];
    if (!states?.length || states.includes('Telangana'))  pool.push(...INDEX.eamcet_ts);
    if (states?.includes('Andhra Pradesh'))               pool.push(...INDEX.eamcet_ap);
    if (!pool.length) pool = [...INDEX.eamcet_ts];

    results = pool
      .filter(c => c.fees <= budget * 1.25)
      .map(c => {
        const prob = calcProbEAMCET(rank, c.cutoff, c.baseProb);
        if (!prob) return null;
        return {
          name:c.name, branch:selectedBranch, fees:c.fees, state:c.state,
          cutoff:c.cutoff, effectiveCutoff:c.cutoff,
          prob, category:assignCategory(prob),
          nirf:c.nirf, avgPkg:c.avgPkg, highPkg:c.highPkg, rating:c.rating,
          placement:c.placement, research:c.research, infra:c.infra,
          tags:c.tags, qScore:Math.round(qualityScore(c,weights)*10)/10,
          dataSource:'EAMCET (estimated)',
        };
      }).filter(Boolean);

  } else {
    let pool = rank > ADV_QUALIFIER_CUTOFF
      ? INDEX.jee.filter(c => !c.requiresAdvanced)
      : INDEX.jee;

    if (states?.length) {
      const sf = pool.filter(c => states.includes(c.state));
      if (sf.length >= 5) pool = sf;
    }

    results = pool
      .filter(c => c.fees <= budget * 1.25)
      .map(c => {
        const prob = calcProbJEE(rank, c, selectedBranch);
        if (!prob) return null;
        const effectiveCutoff = c.branches[selectedBranch] || c.branches['CSE'] || 0;
        const dataSource = c.branches[selectedBranch]
          ? `JoSAA 2021–2025 (${selectedBranch})`
          : `JoSAA 2021–2025 (CSE proxy)`;
        return {
          name:c.name, branch:selectedBranch, fees:c.fees, state:c.state,
          cutoff:effectiveCutoff, effectiveCutoff,
          prob, category:assignCategory(prob),
          nirf:c.nirf, avgPkg:c.avgPkg, highPkg:c.highPkg, rating:c.rating,
          placement:c.placement, research:c.research, infra:c.infra,
          tags:c.tags, qScore:Math.round(qualityScore(c,weights)*10)/10,
          requiresAdvanced:c.requiresAdvanced, dataSource,
        };
      }).filter(Boolean);
  }

  results = results
    .sort((a,b) => {
      const o = { dream:0, moderate:1, safe:2 };
      if (o[a.category] !== o[b.category]) return o[a.category]-o[b.category];
      return b.qScore - a.qScore;
    })
    .slice(0, 20);

  const topColleges = results.slice(0,5).map(c=>`${c.name} (${c.prob}%, avg Rs.${c.avgPkg}L pkg)`).join('; ');
  const prompt = `You are an expert Indian engineering admission counselor.
Student: ${name||'Student'}, ${examType==='eamcet'?'EAMCET':'JEE'} Rank ${rank}, ${selectedBranch}, Budget Rs.${budget}.
Top matches: ${topColleges}.
Priorities: ${Object.entries(weights).filter(([,v])=>v>0).map(([k])=>k).join(', ')}.

Respond ONLY in this format:
Strengths:
- [point]
- [point]
Weaknesses:
- [point]
- [point]
Suggestions:
- [point]
- [point]
- [point]
Max 18 words per point.`;

  try {
    const r = await axios.post(AI_URL,
      { model:MODEL, max_tokens:380, messages:[{role:'user',content:prompt}] },
      { headers:{Authorization:AI_KEY,'Content-Type':'application/json'} }
    );
    const payload = { colleges:results, insights:r.data.choices[0].message.content };
    if (responseCache.size >= CACHE_MAX) responseCache.delete(responseCache.keys().next().value);
    responseCache.set(cacheKey, payload);
    res.json(payload);
  } catch(e) {
    console.error('AI ERROR:', e.response?.data||e.message);
    res.json({ colleges:results, insights:'AI unavailable — predictions based on JoSAA historical data.' });
  }
});

// ── CHATBOT ───────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, history, context } = req.body;

  const collegeSummary = context?.colleges
    ? context.colleges.slice(0,6).map(c=>`${c.name} (${c.prob}%, Rs.${c.avgPkg}L avg, ${c.category})`).join('; ')
    : '';

  const sysBlock = [
    'You are AdmissionAI, an expert Indian engineering admissions counselor.',
    context?.rank ? `Student: ${context.name||'Student'}, ${context.examType==='eamcet'?'EAMCET':'JEE'} rank ${context.rank}, ${context.branch}, budget Rs.${(context.budget/100000).toFixed(1)}L/yr.` : '',
    collegeSummary ? `Top colleges: ${collegeSummary}` : '',
    'Reply in 3-4 sentences max. Be specific, honest, and encouraging.',
  ].filter(Boolean).join('\n');

  const recentHistory = (history||[]).slice(-8);
  const histText = recentHistory
    .filter((m,i) => !(m.role==='bot' && i===0))
    .map(m => `${m.role==='user'?'Student':'Counselor'}: ${m.text}`)
    .join('\n');

  const fullPrompt = sysBlock+'\n\n'+(histText?histText+'\n':'')+`Student: ${message}\nCounselor:`;

  try {
    const r = await axios.post(AI_URL,
      { model:MODEL, max_tokens:200, messages:[{role:'user',content:fullPrompt}], temperature:0.7 },
      { headers:{Authorization:AI_KEY,'Content-Type':'application/json'}, timeout:14000 }
    );
    const reply = r.data?.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('Empty response');
    res.json({ reply });
  } catch(e) {
    const status = e.response?.status;
    console.error(`[CHAT ERROR] status=${status} — ${e.response?.data?.error?.message||e.message}`);
    let msg = "Sorry, I couldn't connect right now. Try again in a moment.";
    if (status===401||status===403) msg='AI auth failed — check FEATHERLESS_KEY in your .env';
    else if (status===429)          msg='Rate limit hit — wait a few seconds and try again.';
    else if (e.code==='ECONNABORTED') msg='AI timed out. Try a shorter question.';
    res.json({ reply:msg });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
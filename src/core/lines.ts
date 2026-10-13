import type { Service } from './network.ts';

/** THE LINES: every station of every service, in order, as SL runs them */

const GREEN_WEST_HASSELBY = [
  'Hässelby strand',
  'Hässelby gård',
  'Johannelund',
  'Vällingby',
  'Råcksta',
  'Blackeberg',
  'Islandstorget',
  'Ängbyplan',
  'Åkeshov',
];
const GREEN_WEST_INNER = ['Brommaplan', 'Abrahamsberg', 'Stora mossen', 'Alvik'];
const GREEN_TRUNK = [
  'Kristineberg',
  'Thorildsplan',
  'Fridhemsplan',
  'S:t Eriksplan',
  'Odenplan',
  'Rådmansgatan',
  'Hötorget',
  'T-Centralen',
  'Gamla stan',
  'Slussen',
  'Medborgarplatsen',
  'Skanstull',
  'Gullmarsplan',
];
const GREEN_SKARP = ['Skärmarbrink', 'Hammarbyhöjden', 'Björkhagen', 'Kärrtorp', 'Bagarmossen', 'Skarpnäck'];
const GREEN_FARSTA = [
  'Skärmarbrink',
  'Blåsut',
  'Sandsborg',
  'Skogskyrkogården',
  'Tallkrogen',
  'Gubbängen',
  'Hökarängen',
  'Farsta',
  'Farsta strand',
];
const GREEN_HAGSATRA = [
  'Globen',
  'Enskede gård',
  'Sockenplan',
  'Svedmyra',
  'Stureby',
  'Bandhagen',
  'Högdalen',
  'Rågsved',
  'Hagsätra',
];

const RED_NORTH_ROPSTEN = ['Östermalmstorg', 'Karlaplan', 'Gärdet', 'Ropsten'];
const RED_NORTH_MORBY = [
  'Östermalmstorg',
  'Stadion',
  'Tekniska högskolan',
  'Universitetet',
  'Bergshamra',
  'Danderyds sjukhus',
  'Mörby centrum',
];
const RED_TRUNK_SOUTH = [
  'T-Centralen',
  'Gamla stan',
  'Slussen',
  'Mariatorget',
  'Zinkensdamm',
  'Hornstull',
  'Liljeholmen',
];
const RED_NORSBORG = [
  'Aspudden',
  'Örnsberg',
  'Axelsberg',
  'Mälarhöjden',
  'Bredäng',
  'Sätra',
  'Skärholmen',
  'Vårberg',
  'Vårby gård',
  'Masmo',
  'Fittja',
  'Alby',
  'Hallunda',
  'Norsborg',
];
const RED_FRUANGEN = ['Midsommarkransen', 'Telefonplan', 'Hägerstensåsen', 'Västertorp', 'Fruängen'];

const BLUE_TRUNK = [
  'Kungsträdgården',
  'T-Centralen',
  'Rådhuset',
  'Fridhemsplan',
  'Stadshagen',
  'Västra skogen',
];
const BLUE_HJULSTA = [
  'Huvudsta',
  'Solna strand',
  'Sundbybergs centrum',
  'Duvbo',
  'Rissne',
  'Rinkeby',
  'Tensta',
  'Hjulsta',
];
const BLUE_AKALLA = ['Solna centrum', 'Näckrosen', 'Hallonbergen', 'Kista', 'Husby', 'Akalla'];

export const SERVICES: Service[] = [
  {
    id: '17',
    color: 'green',
    stations: [...GREEN_WEST_HASSELBY.slice(-1), ...GREEN_WEST_INNER, ...GREEN_TRUNK, ...GREEN_SKARP],
  },
  {
    id: '18',
    color: 'green',
    stations: ['Alvik', ...GREEN_TRUNK, ...GREEN_FARSTA],
  },
  {
    id: '19',
    color: 'green',
    stations: [...GREEN_WEST_HASSELBY, ...GREEN_WEST_INNER, ...GREEN_TRUNK, ...GREEN_HAGSATRA],
  },
  {
    id: '13',
    color: 'red',
    stations: [...[...RED_NORSBORG].reverse(), ...RED_TRUNK_SOUTH.slice().reverse(), ...RED_NORTH_ROPSTEN],
  },
  {
    id: '14',
    color: 'red',
    stations: [...[...RED_FRUANGEN].reverse(), ...RED_TRUNK_SOUTH.slice().reverse(), ...RED_NORTH_MORBY],
  },
  {
    id: '10',
    color: 'blue',
    stations: [...[...BLUE_HJULSTA].reverse(), ...BLUE_TRUNK.slice().reverse()],
  },
  {
    id: '11',
    color: 'blue',
    stations: [...[...BLUE_AKALLA].reverse(), ...BLUE_TRUNK.slice().reverse()],
  },
];

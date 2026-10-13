/** short form for train destination signs */
export const shortName = (name: string): string =>
  name
    .replace('Hässelby strand', 'Hässelby s.')
    .replace('Farsta strand', 'Farsta s.')
    .replace('Mörby centrum', 'Mörby c.')
    .replace('Danderyds sjukhus', 'Danderyd')
    .replace('Sundbybergs centrum', 'Sundbyberg')
    .replace('Tekniska högskolan', 'Tekniska h.')
    .replace('Kungsträdgården', 'Kungsträdg.');

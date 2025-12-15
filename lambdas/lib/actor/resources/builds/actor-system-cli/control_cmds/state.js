import { Command } from 'commander';

const stateCommand = new Command('state')
  .description('<<>>')
  .action(async () => {
    console.log('hello from state command');
  });

export default stateCommand;

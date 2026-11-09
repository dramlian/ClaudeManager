import { Forest } from './Forest';
import { FolderSearch } from './FolderSearch';

type Props = {
  onOpen: (folder: string) => void;
};

export function StartScreen({ onOpen }: Props) {
  return (
    <div className="start">
      <Forest />
      <div className="start-card">
        <div className="start-logo">&gt;_</div>
        <h1>claude-manager</h1>
        <p className="sub">
          Pick a project from your workspace. Claude runs with <code>--dangerously-skip-permissions</code>.
        </p>

        <div className="start-section">
          <FolderSearch variant="start" onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}

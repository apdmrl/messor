import { useParams } from 'react-router-dom'
import type { ReactElement } from 'react'

export function ProjectBoardPlaceholder(): ReactElement {
  const { projectKey } = useParams<{ projectKey: string }>()

  return (
    <div className="future-package">
      <h2 className="future-package__heading">Board</h2>
      <p className="future-package__text">
        {projectKey !== undefined
          ? `${projectKey} projesinin board'u sonraki pakette tamamlanacak.`
          : 'Board sonraki pakette tamamlanacak.'}
      </p>
    </div>
  )
}

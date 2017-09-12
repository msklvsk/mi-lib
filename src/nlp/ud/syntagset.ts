export type Ud20UniversalRelation =
  | 'acl'
  | 'advcl'
  | 'advmod'
  | 'amod'
  | 'appos'
  | 'aux'
  | 'case'
  | 'cc'
  | 'ccomp'
  | 'compound'
  | 'conj'
  | 'cop'
  | 'csubj'
  | 'det'
  | 'discourse'
  | 'dislocated'
  | 'expl'
  | 'fixed'
  | 'flat'
  | 'goeswith'
  | 'iobj'
  | 'list'
  | 'mark'
  | 'nmod'
  | 'nsubj'
  | 'nummod'
  | 'obj'
  | 'obl'
  | 'orphan'
  | 'parataxis'
  | 'punct'
  | 'reparandum'
  | 'root'
  | 'vocative'
  | 'xcomp'

export type Ud20MiSpecificRelation =
  | 'aux:pass'
  | 'conj:parataxis'
  | 'conj:repeat'
  | 'csubj:pass'
  | 'det:numgov'
  | 'det:nummod'
  | 'flat:foreign'
  | 'flat:name'
  | 'flat:title'
  | 'nsubj:pass'
  | 'nummod:gov'
  | 'obl:agent'
  | 'parataxis:discourse'
  | 'acl:2'
  | 'advcl:2'
  | 'xcomp:2'
  | 'flat:repeat'
  | 'appos:nonnom'
  | 'advmod:amtgov'

  | 'advcl:svc'
  | 'conj:svc'
  | 'xcomp:svc'
  | 'ccomp:svc'
  | 'compound:svc'


export type UdMiRelation = Ud20UniversalRelation | Ud20MiSpecificRelation


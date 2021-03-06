# Rapport

_Problématique_ : les sandboxes proposées aux clients génèrent des traces qu’il est utile de pouvoir inspecter. Seulement, à l’heure actuelle, les traces générées par les sandboxes ne sont pas persistées, il est seulement possible de les afficher en temps réel, et il est peu aisé de réaliser des recherches approfondies dessus.
Ce rapport présente mes recherches sur un prototype avec la stack opensource elastic (Logstash, Elastic-Search, Kibana), permettant d’indexer les traces au fur et à mesure puis de réaliser des recherches dessus.

rédaction : août 2018,
version d'Elasticsearch : 6.3

## Connexion

Pour ce prototype, la connexion aux sandboxes pour récupérer les traces est effectuée par un serveur NodeJS. Sa seule utilité est de se connecter aux sandboxes puis de réinjecter ces traces dans la brique suivante de la stack : logstash.
Le serveur est très simple, vous pouvez retrouver un exemple avec le fichier [leocare.js](https://github.com/LucasPLA/prototype-elasticsearch/blob/master/NodeJS/leocare.js)

A noter que la stack elastic propose également un ensemble d’outils : [beats](https://www.elastic.co/fr/products/beats), pour récupérer les traces notamment depuis un fichier.

La connexion pourrait être gérée par la brique logstash directement; c'est plus propre, mais un peu moins rapide à mettre en place. Le serveur NodeJs offre aussi des possibilités de modification/redirection des logs, et dans un langage connu chez zetapush.

## Logstash

> « Logstash est un pipeline open source qui ingère et traite simultanément des données provenant d'une multitude de sources, puis les transforme et les envoie vers votre système de stockage préféré »

Logstash se chargera de la liaison entre les données venues du server NodeJS, transmises en http, et le serveur Elasticsearch, en appliquant au passage quelques modifications/filtres sur les données.

L’installation est extrêmement simple : https://www.elastic.co/fr/downloads/logstash
puis pour lancer un serveur logstash :

```
bin/logstash -f <le fichier de conf>
```

--config.reload.automatic si l’on veut que le serveur se met à jour automatiquement lorsque l’on modifie le fichier de configuration

### Écrire le fichier de configuration

Pour vérifier la validité d'une config :

```
bin/logstash -f <le fichier de conf> --config.test_and_exit
```

Une config valide pourra toutefois générer des erreurs si il y a un problème de mapping (cf paragraphe mapping un peu plus loin)

Il existe pas mal de possibilités de manipulation des données, de filtrage, ... pour peu que l'on soit prêt à consacrer du temps dans la documentation. Il est aussi possible d'utiliser des scripts (en ruby seulement ...) au seins même du pipeline logstash.

Pour lancer plusieurs pipelines logstash simplement, il est possible de préciser les pipelines dans le fichier config/pipelines.yml ; il n’y aura ensuite plus qu’a lancer la commande bin/logstach
https://www.elastic.co/guide/en/logstash/6.3/multiple-pipelines.html

### Présentation du pipeline hq-pipeline.conf

* input permet de spécifier les différentes entrées pour ce pipeline. Ici il n'y en a qu'une (via http sur le port 4440), mais on pourrait imaginer en avoir plusieurs, et recevoir en autre chose que du http (ex: la doc pour du [TCP](https://www.elastic.co/guide/en/logstash/current/plugins-inputs-tcp.html)). L'attribut 'codec' permet de spécifier à logstash le type des attributs qu'il reçoit, sachant que sans il est capable de se débrouiller mais peut commettre des erreurs.

* filter permet de modifier à la volée le flux de donnée. Il existe une tonne d'extensions pour ce faire : https://www.elastic.co/guide/en/logstash/current/filter-plugins.html.
Un des plus utile est probablement 'mutate' qui permet de modifier les données par des conversions, des copies, des renommages, ... Ici 'remove_field' permet de supprimer des champs des datas (et les données qui vont avec), les données que ces champs contenaient n'étaient pas pertinentes pour la suite; et 'rename' est un peu tricky : il renomme le champs data en un sous-champs de data (le champs 'comment', enfant de data et qui en est une copie, est créer à la volée). En soit, cette mutation n'est plus nécessaire sur ce pipeline, mais elle aurait permit de regrouper les documents 'CMT' et des macros dans un même index sans collisions de type sur le champs data.

'json_encode' sérialise un objet en json et le stringifie. On l'utilise ici pour stringifier tous les objets en provenance de "USR", car ceux-ci étant des tableaux d'objets de types différents, on aurait encore collision sur les types. Ainsi, les champs data de toutes données USR seront des chaînes de caractères.
__/!\attention :__ le pluggin json_encode doit être installé au préalable : https://www.elastic.co/guide/en/logstash/current/plugins-filters-json_encode.html

* output sera là où l'on précisera vers où envoyer les données et comment. Il est ici assez facile à comprendre. A noter que propulser des données vers un index n'existant pas encore le créera (mapping dynamique).

il est à tout moment possible de mettre des conditions sur les filtres, et même les entrées et les sorties.

## Elasticsearch

Elasticsearch est une base de donnée nosql distribuée, intégrant un moteur de recherche (basé sur Apache Lucene) RESTful.

Installation très simplement encore une fois : https://www.elastic.co/downloads/elasticsearch
Pour lancer elasticsearch :

```
bin/elasticsearch
```

Seul, il est difficile d'avoir des informations sur l'état de la base de donnée. Un addon pratique pour visualiser ses données/les gérer : Elastic-head
Les étapes pour le mettre en place sont disponibles ici : https://github.com/mobz/elasticsearch-head (ne pas omettre d’autoriser les [CORS](https://developer.mozilla.org/fr/docs/Web/HTTP/CORS) dans elasticsearch)

Un lien intéressant : https://www.elastic.co/guide/en/elasticsearch/reference/current/_basic_concepts.html

### Shards et niveau de santé

Elasticsearch est distribué, et de ce que j'en ai vu, la distribution semble assez bien foutue.
Chaque index (table de donnée) est découpé en 'shards', qui seront automatiquement distribuées entre les différentes machines du cluster. Cela rend les recherches rapide et l'architecture fortement scalable. Il est également possible de prévoir des shards de redondance.

La gestion des shards peut-être faite au niveau des index en précisant le nombre de shards pour cet index:
https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-create-index.html  
ou au niveau de la configuration d'elasticsearch : /config/elasticsearch  
https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules.html  
https://www.elastic.co/guide/en/elasticsearch/reference/current/important-settings.html

### Choix de la répartition en index des données

Les index sont un peu comme des tables pour un setup SQL.

Il est probablement meilleur de découper autant que possible les données en un maximum d'index : cela permet d'avoir plus de flexibilité, et permet d'augmenter les performances sur les recherches, du moment que l'on sait dans quel index se trouve ce que l'on cherche. La découpe en index se fait au niveau du pipeline logstash.

On pourrait donc pour chaque sandbox créer des index CMT, USR et un index regroupant les macros.

### Mapping

Un peu comme une table SQL, ES va donner un type unique à chacun des champs que contiennent les documents qui lui sont injectés : c'est le mapping (mais contrairement au sql, le nombre de champs n'est pas fixe, et chaque document ne renseigne pas forcément tout les champs). Cela permet à ES d'être plus efficace sur le traitement des requêtes.
De base le mapping est dynamique et géré par ES, et c'est plutôt correct. En revanche, un problème qui s'est posé est qu'il lui est impossible d'assigner plusieurs types à un seul même champ (par exemple le champs 'data' des traces commentaire est une string tandis que celui des macros est un objet). Il faut séparer les données dans différents index ou les reformater (avoir un champs 'data' de type object contenant d'autres champs de nom et type différents) .

Il est possible de changer ou de spécifier manuellement le mapping (l'index doit être écrasé d'abord) : https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html

Pour prévenir de toute collision et parce que tous les champs ne sont pas toujours intéressant à rechercher, il est possible de demander à ES de ne pas [analyser](https://www.elastic.co/guide/en/elasticsearch/reference/current/analyzer-anatomy.html) certains champs, en précisant le paramètre [enable](https://www.elastic.co/guide/en/elasticsearch/reference/current/enabled.html).
Dans notre cas, il est intéressant de désactiver les champs 'parameters' et 'result' de l'index des macro : kermit. Ils seront toujours enregistrés et récupérable, mais il n'est plus possible de faire de recherche dessus. Ci-dessous un mapping pour préciser la désactivation. En cas de problème avec celui-ci, un mapping plus complet est disponible [ici](https://github.com/LucasPLA/prototype-elasticsearch/blob/master/mapping).

```
PUT kermit
{
  "mappings": {
    "doc": {
      "dynamic": "true",
      "properties": {
        "data": {
          "properties": {
            "parameters": {
              "enabled": false
            },
            "result": {
              "enabled": false
            }
          }
        }
      }
    }
  }
}
```

Note: la version lors de la rédaction de ce rapport est ES 6.3, il se peut que dans la version 7 le mapping soit tout simplement retiré.

### Requête sur l'elasticsearch

ES étant basé sur lucene, il est fortement requêtable. Là où est le soucis, c'est que c'est un langage assez complet à maîtriser, et faire des requêtes complexes demandera pas mal de temps de documentation.
La documentation sur les requêtes : https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html. En fin de document, j'ai mis quelques exemples de requêtes que j'ai effectué.

Au vu de toutes les possibilités offertes, tout doit être à peu près requêtable. Attention tout de même puisque dès que les requêtes se complexifient, elles deviennent très rapidement extrêmement lourdes à l'écriture (10 à 15 niveaux d'indentation).

ES étant RESTful, il peut être interrogé d'à peu près partout. Kibana possède un devtool assez pratique pour faire les requêtes.

### Requêtage d'elasticsearch directement depuis les dev-tools

Il est assez aisé d'interroger le serveur ES grâce au module http :
```
this.http.get('http://localhost:9200/kermit/_search?q=(ctx:314)AND(type:MS)').subscribe(
  (value) => {console.log(value)}
)
```

Seulement les requêtes pouvant être assez complexes, cette méthode risque d'être limitée.

ES possède à priori de nombreuses API javascript, et des paquets npm avec :  
https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/quick-start.html  
https://www.npmjs.com/package/elasticsearch  

Pour arriver à quelque chose sur angular, j'ai du pas mal batailler avec npm (les paquets ES semblent un peu vacillants) et une documentation peu dense et peu à jour; mais bon, comme ne le dirait pas Gilda, avec stack overflow on arrive finalement à tout. Un exemple bref [ICI](https://github.com/LucasPLA/prototype-elasticsearch/blob/master/angular/error-view.component.ts). 2 liens qui m'ont été utiles :  
https://grokonez.com/frontend/angular/angular-4-elasticsearch-example-quick-start-how-to-add-elasticsearch-js  
https://stackoverflow.com/questions/50313745/angular-6-process-is-not-defined-when-trying-to-serve-application/50313953  
(peut-être sera t-il nécessaire d'installer le [browser build](https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/browser-builds.html)) 

### Parenté et arbre des macros appelées

En théorie, l'arbre d'appel des macros pourrait transparaître dans les index ES grâce à la relation join.
En pratique, ce n'est pas forcément une bonne idée : cela va rendre les recherches beaucoup plus coûteuses; cela va aussi complexifier la façon dont les données doivent être indexées; et une question que l'on peut se poser est : est-ce vraiment utile ? il est probablement plus aisé de recréer l'arbre d'appel là où l'on en a besoin, en récupérant toutes les entrées pour un ctx.
https://www.elastic.co/guide/en/elasticsearch/reference/current/parent-join.html

## Kibana

Kibana est un outil de monitoring qui permet de créer des visualisations des données Elasticsearch.

Installation simple (encore) : https://www.elastic.co/fr/downloads/kibana
Pour lancer kibana :

```
bin/kibana
```

### Index pattern

Les index patterns permettent de regrouper un ou plusieurs index, c'est sur eux que l'on pourra lancer des visualisations. On peut en créer à tout moment dans l'onglet management/index patterns.
On choisi les index que l'on ajoute au pattern par leur nom ou le wildcard *. Plusieurs recherches peuvent être faites séparées par une virgule.
Le time filter permet de préciser quel champ Kibana considérera pour les recherches sur une base temporelle.

### Discover

Une interface pour avoir une vision sur le jeu de donnée. Il est possible de trier les entrée par une recherche proche de celles utilisées sur ES. Les tris peuvent être sauvegardés pour être utilisés dans une visualisation.
https://www.elastic.co/guide/en/elasticsearch/reference/5.1/query-dsl-query-string-query.html#query-string-syntax
https://www.cheatography.com/alasta/cheat-sheets/kibana-search-v5/

### Visualize

L'outil pour générer des visualisations. Il n'est pas super intuitif, et de ce que j'en ai vu, pas super puissant non plus, mais permet de créer facilement tout graphique pourvu qu'il ne soit pas trop compliqué.

la méthode pour créer une visualisation est un peu toujours la même :

* la visualisation peut-être faite sur un index pattern, ou alors sur une partie des données triées par une recherche préalable.

* Y-axis permet de définir ce que l'on met sur l'axe des Y. Ce sera surtout Count

* X-Axis permet de définir ce que l'on met sur l'axe des X :

  * aggregation : une définition pas très claire peut-être trouvée ici : https://www.elastic.co/guide/en/elasticsearch/reference/6.3/search-aggregations.html.
Globalement, cela va permettre de définir le format des données de l'axe des X ('terms' pour avoir des valeurs sur chaque terme du champs que l'on précisera, 'range' pour avoir des valeurs sur des intervalles que l'on précisera, 'Date Histogram' pour avoir des valeurs par tranche de temps, ...)

  * les autres champs sont plûtot intuitifs

* Split Series : permet de découper les différents champs affichés en fonction d'autres champs. Un exemple ici : https://www.rittmanmead.com/blog/content/images/2016/08/350ckib18.png

* Split Charts : permet de découper le diagramme en fonction d'autres champs. Un exemple ici : https://i.stack.imgur.com/4P7OK.png

En haut à gauche, on a aussi la possibilité de filtrer les données utilisées (choisir si l'on veut un seul owner, choisir une fenêtre de temps sur laquelle observer, ...)
La période sur laquelle on observe peut aussi à tout moment être choisie en haut à droite. Elle est commune à toutes les visualisations que l'on fait. (il faut la considéré comme un filtre. Elle est appliquée même si un filtre sur la période d'observation avait été renseigné).

Pour __résumer__ le fonctionnement de l'outil vizualise : on choisi de manière générale la forme de la visualisation grâce aux agrégations, et si l'on a besoin de préciser les données (prendre juste un owner, ...), le temps, on peut utiliser les filtres.

L'outil de visualisation n'est pas performant sur toute la ligne, et il est parfois un peu épineux de savoir comment s'y prendre. Heureuse nouvelle : la team Kibana développe de nouveaux outils assez puissants pour pallier les manques de vizualise :

#### Timelion

> "Timelion is the clawing, gnashing, zebra killing, pluggable time series interface for everything"
pas très vegan ...

L'outil permet de créer des timelines. Il est très pratique et pas trop compliqué d'utilisation, avec des fonctionnalités parfois vraiment adaptées au besoin. Toutes les infos peuvent être trouvées sur la documentation (https://www.elastic.co/guide/en/kibana/current/timelion.html) ou directement sur l'outil. Dommage qu'il n'y ait pas de feuille récap' des commandes timelion ...

#### Vega

Un outil actuellement en beta, mais qui pourrait devenir très pratique.
Il permet de faire l'équivalent de l'outil vizualise, mais en définissant la vue grâce à un langage, ce qui apporte plus de flexibilité et des fonctionnalités essentielles si l'on veut pouvoir faire des visualisations exactement comme on le souhaite, comme lancer un graphique sur les résultats d'une recherche ES. Ci-dessous un exemple : on souhaite afficher un barchart sur le temps de chaque appel de macro, soit récupérer un object nesté dans le document dont le 'n' est le maximum pour chaque 'ctx' (impossible sans vega). A la suite, la recherche Elasticsearch :

```
POST /kermit/_search
{
  "size": 0,
  "aggs": {
    "counters": {
      "terms": { "field": "ctx", "size": 50 },
      "aggs": {
        "hits": {
          "top_hits": {
            "sort": [
              {
                "n": {
                  "order": "desc"
                }
              }
            ],
            "size": 1
          }
        }
      }
    }
  }
}
```
(TO IMPROVE : https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations-bucket-composite-aggregation.html)

La configuration vega peut être retrouvée [ici]().

Vega, ce n'est pas seulement vizualise sous la forme d'un langage. L'outil permet également de créer toute une panoplie de graphiques aussi esthétiques que mystérieux de sens. D'autres exemples [ici](https://vega.github.io/vega/examples/).

### Dashboard

Il suffit d'ajouter des visualisations déjà sauvegardées. On a la aussi la possibilité de choisir la période d'observation, la fréquence de rafraîchissement des données affichées et d'appliquer des filtres.
Je conseil de cocher la case 'Store time with dashboard', qui permet d'associer une période d'observation avec le dashboard.

Les dashboards peuvent être exportés par une url (dans dashboard, share en haut à gauche); ou en json (dans management, saved objects). Une iframe du dashboard peut-être intégré à un site, et pour un test avec angular, c'est vraiment stylé. (/!\ En exportant un dashboard que j'étais en train d'éditer, le dashboard intégré dans angular pouvait aussi être édité ...)

Un 'dark-theme' peut-être activé dans l'onglet edit/options du dashboard.

## Viabilité de la stack Elastic pour la persistance des données et le monitoring

ES à l'avantage d'être facile à mettre en place, de ne pas être trop compliqué d'un point de vue système, et il répond bien au besoin, tout en proposant une flexibilité dans les requêtes qui permettra de filtrer comme l'on souhaite les données affichées en console. L'interfaçage avec Kibana, même sans être explorée au maximum, permet d'avoir facilement des insights très parlants; et la stack en plusieurs briques permet d'avoir une architecture assez flexible.

Cependant, si la stack à la force d'être très complète, elle est aussi assez hard to master avec un DSL particulier pour logstash, un pour les recherches ES, certaines fonctionnalités Kibana on aussi un DSL propre même si il reste proche du DSL ES. Cela va donc impliquer d'avoir quelqu'un qui consacrera un temps certain à ce documenter sur la stack.

## Scalabilité du set-up

ES avec son fonctionnement en shard, est très facilement scalable. Logstash l'est facilement aussi.
https://www.elastic.co/guide/en/logstash/current/deploying-and-scaling.html
Quant-à l'automatisation, logstash et ES incorpore une armée de plugins. Automatiser la création de pipelines/index doit être possible.
https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-templates.html

### Exemples de questions

trick intéressant : l'onglet 'Recherche structurée' d'ES-head permet de faire des recherches et peut afficher la requête source.

* obtenir tous les enregistrements d'un certain owner:

```
POST /kermit,fozzy/_search
{
  "query":{
    "match":{"owner": "bhixoq8yVwG1k-x5yJtgGw"}
  }
}
```

* faire une recherche d'une string dans un champ particulier :

```
POST /kermit,fozzy/_search
{
  "query":{
    "query_string":{
      "query":"core_file__getFileEntryListByService",
      "fields":["data"]
      }
    }
  }
}
```

* chercher les traces d'un owner et d'un type particulier

```
POST /kermit,fozzy/_search
{
  "query":{
    "query_string":{
      "query": "owner:bhixoq8yVwG1k-x5yJtgGw AND type:MS"
    }
  }
}
```

* recherche des traces d'un owner pour un ctx inférieur à 940, avec deux résultats par page

```
POST /kermit,fozzy/_search
{
  "query":{
    "bool" : {
      "must" : {
        "match" : {"owner": "bhixoq8yVwG1k-x5yJtgGw"}
      },
      "filter" : {
        "range": {
          "ctx": {
            "lte": 940
          }
        }
      }
    }
  },
  "from": 0,
  "size": 2,
}
```

https://www.elastic.co/guide/en/elasticsearch/guide/current/nested-query.html

* traces pour une plage horaire donnée

```
POST /kermit,fozzy/_search
{
  "query":{
    "bool" : {
      "must" : {
        "match" : {"owner": "bhixoq8yVwG1k-x5yJtgGw"}
      },
      "filter" : {
        "range": {
          "@timestamp": {
            "lte": "2018-07-31T15:07:50",
            "gte": "2018-07-31T15:07:40"
          }
        }
      }
    }
  }
}
```

* obtenir le n maximum pour chaque ctx distinct

```
POST /kermit/_search
{
  "aggs": {
    "counters": {
      "terms": { "field": "ctx" },
      "aggs": {
        "maxn": {
          "max": { "field": "n" }
        }
      }
    }
  }
}
```
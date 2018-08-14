import { Component, OnInit } from '@angular/core';

import { Client } from 'elasticsearch';

@Component({
  selector: 'zp-error-view',
  templateUrl: './error-view.component.html',
})
export class ErrorViewComponent {
  private client: Client;
 
  ngOnInit() {
    this.connect();
    
    /*this.client.ping({
      // ping usually has a 3000ms timeout
      requestTimeout: 1000
    }, function (error) {
      if (error) {
        console.trace('elasticsearch cluster is down!');
      } else {
        console.log('All is well');
      }
    }); */

    this.getAllDocument();

  }

  getAllDocument() {
    console.log(
      this.client.search({
        index: 'kermit',
        body: '{"query":{"match_all":{}}}'
      })
    )
  }

  private connect() {
    this.client = new Client({
      host: 'http://localhost:9200',
      log: 'trace'
    });
  }
}

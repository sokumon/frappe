context('Control Rating', () => {
	before(() => {
		cy.login();
		cy.visit('/desk#workspace/Website');
	});

	function get_dialog_with_rating() {
		return cy.dialog({
			title: 'Rating',
			fields: [{
				'fieldname': 'rate',
				'fieldtype': 'Rating',
			}]
		});
	}

	it('click on the star rating to record value', () => {
		get_dialog_with_rating().as('dialog');

		cy.get('div.rating')
			.children('i.fa')
			.first()
			.click()
			.should('have.class', 'star-click');
		cy.get('@dialog').then(dialog => {
			var value = dialog.get_value('rate');
			expect(value).to.equal(1);
			dialog.hide();
		});
	});

	it('hover on the star', () => {
		get_dialog_with_rating();

		cy.get('div.rating')
			.children('i.fa')
			.first()
			.invoke('trigger', 'mouseenter')
			.should('have.class', 'star-hover')
			.invoke('trigger', 'mouseleave')
			.should('not.have.class', 'star-hover');
	});
});